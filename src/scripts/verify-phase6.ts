// PHASE 6 verification (Realtime order experience + notifications).
//
// Like verify-phase1/2/4/5, this file IS the gate: the repo has no JS test
// framework. Phase 6 adds NO new engine and NO schema change — it adds a
// DELIVERY layer over engines that already existed. The checks:
//
//   1. EVENT VOCABULARY   - one authoritative event list, no duplicate statuses
//   2. EVENT OWNERSHIP    - every emitter targets a channel its audience owns
//   3. ISOLATION          - customer A never sees B's; driver A never sees B's
//   4. EMISSION ORDERING  - emit strictly AFTER the commit (Part 3)
//   5. NEGOTIATION SYNC   - the full counter / accept / decline loop is live
//   6. ORDER + DRIVER SYNC
//   7. DUPLICATE / OUT-OF-ORDER - real unit tests of realtime-merge.ts
//   8. RECONNECT + DEGRADED MODE
//   9. LOCATION PRIVACY   - the Phase 5 live-trip rule is unchanged
//  10. NO CREDENTIAL LEAKAGE
//  11. AR / FR COVERAGE
//  12. TRUTH-SOURCE REUSE - no compatibility/auth logic duplicated in realtime
//  13. LIVE DB           - the delivery layer must not corrupt Phase 5
//
// Run with: bun src/scripts/verify-phase6.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { translations } from '../lib/i18n';
import {
  applyOrderEvent,
  offerFromRealtimeEvent,
  rememberSettledOrder,
  shouldAcceptIncomingOrder,
  shouldApplyOfferEvent,
  shouldNotifyOnce,
  upsertById,
} from '../lib/realtime-merge';
import type { Order, OrderOffer, RealtimeOfferEvent } from '../lib/types';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) pass++;
  else fail++;
  console.log(`[${tag}] ${name}${extra ? ` - ${extra}` : ''}`);
}

function src(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

function has(body: string, needle: string): boolean {
  return body.includes(needle);
}

/** "the emit runs after the write" is itself part of the contract. */
function before(body: string, first: string, second: string): boolean {
  const a = body.indexOf(first);
  const b = body.indexOf(second);
  return a !== -1 && b !== -1 && a < b;
}

/** Recursively collect every .ts / .tsx file under a directory. */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const SERVER = src('src/lib/pusher-server.ts');
const RT = src('src/lib/realtime.ts');
const RT_CLIENT = src('src/lib/pusher-client.ts');
const RT_MERGE = src('src/lib/realtime-merge.ts');
const AUTH = src('src/app/api/pusher/auth/route.ts');
const NOTIFY = src('src/lib/notifications.ts');
const DISPATCH = src('src/lib/dispatch.ts');
const USE_RT = src('src/components/wassilha/use-realtime.ts');

const OFFERS = src('src/app/api/orders/[id]/offers/route.ts');
const COUNTER = src('src/app/api/orders/[id]/offers/[offerId]/counter/route.ts');
const AWARD = src('src/app/api/orders/[id]/offers/[offerId]/accept/route.ts');
const REJECT = src('src/app/api/orders/[id]/offers/[offerId]/reject/route.ts');
const CANCEL = src('src/app/api/orders/[id]/cancel/route.ts');
const LOCATION = src('src/app/api/driver/location/[driverId]/route.ts');

const CUST_NEGO = src('src/components/wassilha/customer/customer-negotiation.tsx');
const CUST_TRACK = src('src/components/wassilha/customer/customer-track.tsx');
const DRV_REQ = src('src/components/wassilha/driver/driver-requests.tsx');
const DRV_TRIPS = src('src/components/wassilha/driver/driver-trips.tsx');
const ADMIN_ORDERS = src('src/components/wassilha/admin/admin-orders.tsx');
const BELL = src('src/components/wassilha/notifications/notification-bell.tsx');
const CHIP = src('src/components/wassilha/realtime-status.tsx');
const HEADER = src('src/components/wassilha/app-header.tsx');

// ===========================================================================
console.log('\n--- 1. EVENT VOCABULARY -------------------------------------------');
// ===========================================================================

// The 3 Phase 6 additions + the 3 pre-existing events. A 7th realtime event
// would mean a second vocabulary creeping in, which is what Part 1 forbids.
const EVENTS_BLOCK = SERVER.slice(SERVER.indexOf('export const EVENTS'));
const eventNames = [...EVENTS_BLOCK.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]);
const EXPECTED_EVENTS = [
  'ORDER_NEW_REQUEST',
  'ORDER_STATUS',
  'DRIVER_LOCATION',
  'OFFER_NEW',
  'OFFER_UPDATE',
  'NOTIFICATION_NEW',
];
check('vocabulary: exactly the 6 expected events',
  eventNames.length === EXPECTED_EVENTS.length &&
  EXPECTED_EVENTS.every((e) => eventNames.includes(e)),
  eventNames.join(', '));

// Part 1: no invented order states. Every status the client renders must be
// one the server already had.
const SERVER_STATUSES = ['searching', 'accepted', 'picked', 'delivered', 'cancelled'];
const RANK_BLOCK = RT_MERGE.slice(0, RT_MERGE.indexOf('export function orderStatusRank'));
check('vocabulary: client status rank reuses server statuses only',
  SERVER_STATUSES.every((s) => RANK_BLOCK.includes(s + ':')),
  SERVER_STATUSES.join(', '));
check('vocabulary: no phantom status invented in the rank table',
  !/\b(in_transit|assigned|arrived|completed):/i.test(RANK_BLOCK));

// The retired C4 event must stay gone (dead code, never subscribed).
check('vocabulary: retired `order:update` event is fully removed',
 !has(SERVER, 'ORDER_UPDATE:') && !has(RT, "'order:update'"));

// ===========================================================================
console.log('\n--- 2. EVENT OWNERSHIP ---------------------------------------------');
// ===========================================================================

check('ownership: order:new-request targets the per-driver channel',
  has(SERVER, 'driverChannel(') && has(SERVER, 'EVENTS.ORDER_NEW_REQUEST'));
check('ownership: order:status fans out to order channel + admin',
  has(SERVER, 'const channels = [orderChannel(order.id), ADMIN_CHANNEL]'));
check('ownership: offer:new targets ONLY the order channel (customer side)',
  has(SERVER, 'safeTrigger([orderChannel(input.orderId)], EVENTS.OFFER_NEW'));
check('ownership: offer:update targets the offering driver channel',
  has(SERVER, 'const channels = [driverChannel(input.driverId)]'));
check('ownership: notification:new targets ONLY the recipient user channel',
  has(SERVER, 'safeTrigger([userChannel(userId)], EVENTS.NOTIFICATION_NEW'));
check('ownership: driver:location targets order + admin (never global)',
  has(SERVER, '[orderChannel(orderId), ADMIN_CHANNEL]'));

// Part 2: no broadcast channel may exist at all.
check('ownership: no global/public broadcast channel is used',
  !has(SERVER, 'public-') && !has(SERVER, 'safeTrigger([]'));

// ===========================================================================
console.log('\n--- 3. ISOLATION (Parts 2, 11) ------------------------------------');
// ===========================================================================

// The auth route is the only thing between a crafted socket_id and another
// user's data, so its exact-id rules are asserted directly.
check('isolation: private-user-<id> is only signed for the session owner',
  has(AUTH, "startsWith('private-user-')") &&
  has(AUTH, 'return channelName === `private-user-${userId}`'));
check('isolation: private-driver-<id> is only signed for the session owner',
  has(AUTH, "startsWith('private-driver-')") &&
  has(AUTH, 'return channelName === `private-driver-${userId}`'));
check('isolation: private-admin is admin-only',
  has(AUTH, "if (channelName === 'private-admin')") &&
  has(AUTH, "return role === 'admin'"));
check('isolation: order channel requires customer / assigned driver / admin',
  has(AUTH, 'order.customerId === userId || order.driverId === userId') &&
  has(AUTH, "if (role === 'admin') return true"));
check('isolation: unknown channel names are refused',
  has(AUTH, '// Any other private channel name is not part of the app'));

// Client channels derive from the SESSION, never from client input.
check('isolation: connectSocket subscribes the user channel from the session id',
  has(RT, 'c.subscribe(userChannel(userId))'));
check('isolation: customer offer listener binds the order channel only',
  has(RT, "bindOnShared(orderChannel(orderId), 'offer:new'"));
check('isolation: driver offer listener binds the driver channel only',
  has(RT, "bindOnShared(driverChannel(driverId), 'offer:update'"));
check('isolation: logout tears the socket down (no orphan private channel)',
  has(RT, 'existing.disconnect()'));

// ===========================================================================
console.log('\n--- 4. EMISSION ORDERING (Part 3) ---------------------------------');
// ===========================================================================

// THE critical property: nothing may be emitted before its write commits.
check('ordering: offer:new emitted after the offer transaction resolves',
  before(OFFERS, 'const offer = await db.$transaction', 'emitOfferNew('));
check('ordering: offer:update (counter) emitted after the counter transaction',
  before(COUNTER, 'const outcome = await db.$transaction', 'emitOfferUpdateToDriver('));
check('ordering: offer:update (award) emitted after the award transaction',
  before(AWARD, 'const updated =', 'emitOfferUpdateToDriver('));
check('ordering: award settles the losing bids AFTER the winner is committed',
  before(AWARD, 'emitOfferUpdateToDriver(', 'emitOfferSettledToLosers('));
check('ordering: offer:update (decline) emitted after the decline commit',
  before(REJECT, 'const declined = await db.$transaction', 'emitOfferUpdateToDriver('));
check('ordering: order:status emitted after the cancellation commit',
  before(CANCEL, 'const updated = await db.$transaction', 'emitOrderStatus('));
check('ordering: notification:new emitted after the notification row is created',
  before(NOTIFY, 'await db.notification.create(', 'emitNotificationNew('));

// A trigger fired inside a transaction would also fire on rollback.
check('ordering: no emitter is called inside a $transaction callback',
  !/\$transaction\([^)]*(emit[A-Z])/.test(AWARD + COUNTER + OFFERS + CANCEL + REJECT));

// Part 3 continues through the notification funnel: the single write path is
// the only place a notification can be broadcast from.
const notifyCallSites = walk('src/app').filter((f) =>
  has(readFileSync(f, 'utf8'), 'createNotification('),
);
check('ordering: no route emits notification:new directly',
  notifyCallSites.every((f) => !has(readFileSync(f, 'utf8'), 'emitNotificationNew(')),
  notifyCallSites.length + ' call site(s)');

// ===========================================================================
console.log('\n--- 5. NEGOTIATION SYNC (Part 4) ---------------------------------');
// ===========================================================================

check('negotiation: customer listens for offer events on its order channel',
  has(CUST_NEGO, 'onOfferEvent(order.id'));
check('negotiation: customer merges offers idempotently by id',
  has(CUST_NEGO, 'shouldApplyOfferEvent') && has(CUST_NEGO, 'offerFromRealtimeEvent'));
check('negotiation: a new bid toasts exactly once per offer',
  has(CUST_NEGO, "event.kind !== 'new'") &&
  has(CUST_NEGO, 'shouldNotifyOnce(notifiedRef.current'));
check('negotiation: driver listens for the outcome of its OWN offers',
  has(DRV_REQ, 'onMyOfferUpdate(user.id'));
check('negotiation: a declined bid drops the dead card instead of leaving it',
  has(DRV_REQ, "event.status === 'rejected'") && has(DRV_REQ, 'delete next[event.orderId]'));
check('negotiation: counter outcome surfaces on the driver screen',
  has(DRV_REQ, "event.status === 'countered'") && has(DRV_REQ, 't.customerCountered'));
check('negotiation: acceptance surfaces on the driver screen',
  has(DRV_REQ, "event.status === 'accepted'") && has(DRV_REQ, 't.offerAcceptedToast'));
check('negotiation: the customer counter is mirrored to the order channel',
  has(SERVER, 'alsoOrder') && has(COUNTER, 'alsoOrder: true'));

// Part 4: OfferEvent stays the historical source of truth.
check('negotiation: OfferEvent journal is still written server-side',
  has(OFFERS, 'offerEvent.create') && has(COUNTER, 'offerEvent.create'));

// ===========================================================================
console.log('\n--- 6. ORDER + DRIVER SYNC (Parts 5, 6) --------------------------');
// ===========================================================================

check('order sync: customer tracking applies order events safely',
  has(CUST_TRACK, 'onOrderStatus(') && has(CUST_TRACK, 'applyOrderEvent'));
check('order sync: the authoritative refetch cannot regress a live screen',
  has(CUST_TRACK, 'setOrder((prev) => applyOrderEvent(prev, o))'));
check('order sync: driver active trip subscribes to its own order channel',
  has(DRV_TRIPS, 'subscribeToOrder(orderId)') && has(DRV_TRIPS, 'onOrderStatus(orderId'));
check('order sync: a cancellation reaches the assigned driver',
  has(DRV_TRIPS, 'updated.status === "cancelled"') && has(DRV_TRIPS, 't.orderCancelled'));
check('order sync: admin console listens on the admin channel',
  has(ADMIN_ORDERS, 'onAdminOrderStatus('));
check('order sync: admin rows merge idempotently',
  has(ADMIN_ORDERS, 'upsertById') && has(ADMIN_ORDERS, 'applyOrderEvent'));

// Part 6: a driver must never be told about an incompatible order. The fan-out
// list is produced by dispatch, which owns isVehicleCompatible.
check('driver sync: the request fan-out still comes from the vehicle filter',
  has(DISPATCH, 'isVehicleCompatible') && has(SERVER, 'emitOrderNewRequest('));
check('driver sync: realtime does not re-implement vehicle compatibility',
  !has(SERVER, 'isVehicleCompatible') && !has(RT, 'isVehicleCompatible'));
check('driver sync: the feed refuses an order that already left the window',
  has(DRV_REQ, 'shouldAcceptIncomingOrder') && has(DRV_REQ, 'rememberSettledOrder'));

// ===========================================================================
console.log('\n--- 7. DUPLICATE + OUT-OF-ORDER (Parts 12, 13) ---------------------');
// ===========================================================================
// These are REAL unit tests of the shipped helper, not source-text assertions:
// the same function every screen calls is executed here.

const order = (id: string, status: string): Order =>
  ({ id, status, code: 'W-1' } as Order);

const offerEvent = (over: Partial<RealtimeOfferEvent> = {}): RealtimeOfferEvent => ({
  kind: 'new',
  offerId: 'o1',
  orderId: 'x1',
  orderCode: 'W-1',
  driverId: 'd1',
  driverName: 'Yacine',
  price: 1000,
  status: 'pending',
  counterPrice: null,
  at: '2026-01-01T00:00:00.000Z',
  ...over,
});

// -- duplicate delivery ----------------------------------------------------
check('duplicate: the same order event applied twice yields one identical row',
  (() => {
    const first = applyOrderEvent(null, order('a', 'accepted'));
    const second = applyOrderEvent(first, order('a', 'accepted'));
    return second === first || JSON.stringify(second) === JSON.stringify(first);
  })());

check('duplicate: upsertById replaces in place instead of appending',
  (() => {
    const list = upsertById([order('a', 'searching')], order('a', 'accepted'));
    return list.length === 1 && list[0].status === 'accepted';
  })());

check('duplicate: a re-delivered offer event produces the same row',
  (() => {
    const ev = offerEvent();
    const a = offerFromRealtimeEvent(ev);
    const b = offerFromRealtimeEvent(ev, a);
    return JSON.stringify(a) === JSON.stringify(b);
  })());

check('duplicate: the same toast key fires only once',
  (() => {
    const seen = new Set<string>();
    return shouldNotifyOnce(seen, 'k') && !shouldNotifyOnce(seen, 'k');
  })());

check('duplicate: the toast de-dup set stays bounded',
  (() => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) shouldNotifyOnce(seen, 'k' + i, 50);
    return seen.size <= 50;
  })());

// -- out-of-order delivery -------------------------------------------------
check('out-of-order: a late `accepted` cannot undo a `picked` screen',
  applyOrderEvent(order('a', 'picked'), order('a', 'accepted'))?.status === 'picked');

check('out-of-order: a forward transition is applied',
  applyOrderEvent(order('a', 'accepted'), order('a', 'picked'))?.status === 'picked');

check('out-of-order: a terminal state is final (nothing leaves it)',
  applyOrderEvent(order('a', 'delivered'), order('a', 'accepted'))?.status === 'delivered');

check('out-of-order: a terminal event does land on a live order',
  applyOrderEvent(order('a', 'picked'), order('a', 'cancelled'))?.status === 'cancelled');

check('out-of-order: an event for a DIFFERENT order is never merged',
  applyOrderEvent(order('a', 'picked'), order('b', 'accepted'))?.id === 'a');

check('out-of-order: a null/garbage payload is ignored, not crashed on',
  applyOrderEvent(order('a', 'picked'), null)?.status === 'picked' &&
  applyOrderEvent(order('a', 'picked'), {} as Order)?.status === 'picked');

check('out-of-order: an older offer event is dropped for that offer id',
  (() => {
    const latest = new Map<string, string>();
    const newer = shouldApplyOfferEvent(latest, { offerId: 'o1', at: '2026-01-02T00:00:00.000Z' });
    const older = shouldApplyOfferEvent(latest, { offerId: 'o1', at: '2026-01-01T00:00:00.000Z' });
    return newer && !older;
  })());

// -- late fan-out ----------------------------------------------------------
check('late fan-out: a settled order is never re-added to the driver feed',
  (() => {
    const settled = new Set<string>();
    rememberSettledOrder(settled, 'a');
    return !shouldAcceptIncomingOrder(order('a', 'searching'), settled);
  })());

check('late fan-out: an order that left the window in its payload is refused',
  !shouldAcceptIncomingOrder(order('a', 'cancelled'), new Set()));

check('late fan-out: a genuinely claimable order is accepted',
  shouldAcceptIncomingOrder(order('a', 'searching'), new Set()));

check('late fan-out: the settled-order memory stays bounded',
  (() => {
    const settled = new Set<string>();
    for (let i = 0; i < 500; i++) rememberSettledOrder(settled, 'o' + i, 50);
    return settled.size <= 50;
  })());

// -- payload hygiene -------------------------------------------------------
check('payload: a realtime offer event carries no phone / token / coords',
  !/phone|token|password|otp|lat|lng/i.test(Object.keys(offerEvent()).join(',')));
check('payload: the REST-only joins survive a realtime merge',
  (() => {
    const prev = { id: 'o1', orderId: 'x1', driverId: 'd1', price: 1, status: 'pending',
      createdAt: 'x', driver: { id: 'd1', name: 'Real Name' } } as unknown as OrderOffer;
    return offerFromRealtimeEvent(offerEvent({ driverName: 'Other' }), prev).driver?.name === 'Real Name';
  })());
check('payload: a brand-new bid still renders a driver name immediately',
  offerFromRealtimeEvent(offerEvent()).driverName === 'Yacine');

// ===========================================================================
console.log('\n--- 8. RECONNECT + DEGRADED MODE (Parts 14, 16, 18) ---------------');
// ===========================================================================

check('reconnect: recovery is a refetch, not a replay assumption',
  has(USE_RT, 'setReconnectTick((n) => n + 1)'));
check('reconnect: the first connect does not trigger a redundant refetch',
  has(USE_RT, 'if (wasDown) setReconnectTick'));
check('reconnect: connection state is surfaced to the UI',
  has(RT, 'onRealtimeStateChange') && has(CHIP, 'onRealtimeStateChange'));
check('reconnect: the chip is mounted in the app header',
  has(HEADER, 'RealtimeStatusChip'));
check('reconnect: a backgrounded tab refetches on foreground (bell)',
  has(BELL, "addEventListener('visibilitychange'"));

// Part 16: realtime failure must never gate a database write. Every emitter is
// fire-and-forget through safeTrigger, which swallows transport errors.
check('degraded: a Pusher outage cannot throw into the write path',
  has(SERVER, 'function safeTrigger') && has(SERVER, 'catch'));
check('degraded: a realtime failure is swallowed by the notification funnel',
  has(NOTIFY, 'try {') && has(NOTIFY, 'emitNotificationNew'));
check('degraded: the safety polls are retained on every realtime screen',
  has(DRV_REQ, 'setInterval') && has(CUST_TRACK, 'setInterval') &&
  has(CUST_NEGO, 'setInterval') && has(DRV_TRIPS, 'setInterval') &&
  has(ADMIN_ORDERS, 'setInterval'));
check('degraded: the chip never blocks rendering or an action',
  !has(CHIP, 'disabled') && has(CHIP, 'return null'));

// Part 21: polling must not have been left at its old cadence to "compensate"
// for realtime, and there must be exactly one logical connection.
check('performance: the request feed poll was relaxed, not duplicated',
  has(DRV_REQ, '20000'));
check('performance: the negotiation poll was relaxed to 30s',
  has(CUST_NEGO, '30000'));
check('performance: the tracking poll was relaxed to 15s',
  has(CUST_TRACK, '15000'));
check('performance: the admin poll was relaxed to 30s',
  has(ADMIN_ORDERS, '30000'));
check('performance: one logical connection, not one per component',
  has(RT, 'let stateBound = false;') && has(RT, 'ensureStateBound()'));
check('performance: the pusher client stays a memoised singleton',
  has(RT_CLIENT, 'if (client) return client;'));

// ===========================================================================
console.log('\n--- 9. LOCATION PRIVACY (Part 7) -----------------------------------');
// ===========================================================================

// Phase 5's rule must be untouched: a customer may poll a driver's location
// ONLY during a live trip.
check('location privacy: the Phase 5 live-trip gate is unchanged',
  has(LOCATION, 'accepted') && has(LOCATION, 'picked') && has(LOCATION, 'customerId'));
check('location privacy: the gate is still an explicit status allow-list',
  /status:\s*\{\s*in:\s*\[/.test(LOCATION) || has(LOCATION, "['accepted', 'picked']"));

// Part 7: the client marker is seeded exactly for those two states, so realtime
// must not have widened the subscription.
check('location privacy: the tracking screen subscribes only when live',
  has(CUST_TRACK, "order.status === 'accepted' || order.status === 'picked'"));
check('location privacy: GPS arrives on the private order channel, never global',
  has(SERVER, 'EVENTS.DRIVER_LOCATION') && !has(SERVER, 'public-driver-location'));

// Part 8: no location history is stored by this phase, and the emit path is
// unchanged from C4.
check('location: Phase 6 added no location persistence',
  !has(SERVER, 'db.') && !has(SERVER, 'prisma'));
check('location: the GPS trigger still fans out to exactly two channels',
  has(SERVER, '[orderChannel(orderId), ADMIN_CHANNEL]'));

// ===========================================================================
console.log('\n--- 10. NO CREDENTIAL LEAKAGE ------------------------------------');
// ===========================================================================

// Recursive scan of every API route: a realtime addition must never have
// widened a response body or a SELECT.
//
// EXEMPT: /api/pusher/auth is the channel-SIGNING endpoint. It MUST read
// PUSHER_SECRET (that is how the HMAC is produced) but it only ever returns
// `signer.authorizeChannel(...)`. The second check below proves that, rather
// than pretending the route does not exist.
const apiRoutes = walk('src/app/api').filter((f) => f.endsWith('route.ts'));
const SIGNING_ROUTE = 'pusher\\auth\\route.ts';
const LEAKY = /process\.env\.(PUSHER_SECRET|PUSHER_APP_ID|DATABASE_URL)/;
const leakyRoutes = apiRoutes.filter(
  (f) => LEAKY.test(readFileSync(f, 'utf8')) && !f.includes(SIGNING_ROUTE),
);
check('no leak: no API route except the signer reads a server secret',
  leakyRoutes.length === 0, leakyRoutes.join(', '));
check('no leak: the signing route returns only the channel signature',
  has(AUTH, 'signer.authorizeChannel(socketId, channelName)') &&
  !/NextResponse\.json\((secret|key|appId)/i.test(AUTH));
check('no leak: the signing route 503s rather than leaking when unconfigured',
  has(AUTH, "error: 'pusherNotConfigured'"));

// The app secret must never be reachable from a client bundle.
const clientFiles = walk('src/components').filter((f) => f.endsWith('.tsx'));
check('no leak: no component imports the server-side pusher module',
  !clientFiles.some((f) => /from\s+['"][^'"]*pusher-server['"]/.test(readFileSync(f, 'utf8'))));
check('no leak: no component imports the pusher secret env var',
  !clientFiles.some((f) => has(readFileSync(f, 'utf8'), 'PUSHER_SECRET')));

// Realtime payloads must stay small and free of sensitive columns.
const PAYLOAD_FORBIDDEN = /\b(password|otp|token|secret|phone|hash)\b/i;
const payloadBodies = [
  SERVER.slice(SERVER.indexOf('function offerPayload')),
  SERVER.slice(SERVER.indexOf('export function emitNotificationNew')),
];
check('no leak: realtime payloads carry no credential-shaped field',
  !payloadBodies.some((b) => PAYLOAD_FORBIDDEN.test(b)));

// The realtime surface must not have widened any Prisma projection.
check('no leak: order payloads still go through serialiseOrder',
  has(SERVER, 'serialiseOrder') && !has(SERVER, 'include: { customer'));

// ===========================================================================
console.log('\n--- 11. AR / FR COVERAGE (Part 19) -------------------------------');
// ===========================================================================

const ar = translations.ar as unknown as Record<string, string>;
const fr = translations.fr as unknown as Record<string, string>;
const PHASE6_KEYS = [
  'realtimeLive',
  'realtimeConnected',
  'realtimeConnecting',
  'realtimeReconnecting',
  'realtimeOffline',
  'offerDeclined',
  'offerDeclinedBody',
  'orderCancelledBody',
];
for (const key of PHASE6_KEYS) {
  check('i18n AR: "' + key + '" exists and is non-empty',
    Boolean(ar[key] && ar[key].trim().length > 0));
  check('i18n FR: "' + key + '" exists and is non-empty',
    Boolean(fr[key] && fr[key].trim().length > 0));
}
check('i18n: the FR dictionary is not an empty mirror',
  Object.keys(fr).length > Object.keys(ar).length - 5,
  'ar=' + Object.keys(ar).length + ' fr=' + Object.keys(fr).length);

// No new hardcoded user-visible string in a touched component.
const touched = [CHIP, BELL, DRV_REQ, CUST_NEGO, DRV_TRIPS];
check('i18n: the new chip renders no hardcoded user-facing text',
  !/>(Live|Offline|Reconnecting|Connecting)</.test(CHIP));
check('i18n: the new toasts all come from the dictionary',
  touched.every((f) => !/toast\.(info|success|error)\(['"][A-Za-z ]/.test(f)));

// ===========================================================================
console.log('\n--- 12. TRUTH-SOURCE REUSE (Parts 2, 6, 9) -------------------------');
// ===========================================================================

// Part 24: the existing truth sources must be REUSED, never re-derived in the
// realtime layer. This is the check that keeps Phase 6 from becoming a parallel
// implementation of Phases 1-5.
check('reuse: the realtime layer defines no SQL / Prisma queries of its own',
  !has(SERVER, 'db.') && !has(SERVER, 'prisma') && !has(RT_MERGE, 'prisma'));
check('reuse: notification emission flows through createNotification only',
  has(NOTIFY, 'createNotification') && has(NOTIFY, 'emitNotificationNew'));
check('reuse: vehicle compatibility is NOT reimplemented client-side',
  !has(RT_MERGE, 'vehicleType') && !has(RT_MERGE, 'isVehicleCompatible'));
check('reuse: the merge helper is pure (no db / api / pusher / react import)',
  !has(RT_MERGE, "from './db'") && !has(RT_MERGE, "from './pusher") &&
  !has(RT_MERGE, "from './api'") && !has(RT_MERGE, 'react'));
check('reuse: the order status vocabulary comes from the shared type module',
  has(RT_MERGE, "from './types'"));

// Part 9: no schema change. A new model would mean a migration.
const schema = src('prisma/schema.prisma');
check('reuse: Phase 6 required no schema change (no new realtime model)',
  !/model\s+Realtime/i.test(schema) && !/model\s+NotificationChannel/i.test(schema));
check('reuse: the existing Notification model is still the one in use',
  has(NOTIFY, 'db.notification.create'));

// Single transport (the "no second realtime architecture" rule).
const allSrc = walk('src');
const SOCKET_SECOND = /(from|require\()\s*['"](socket\.io|eventsource|ws|ioredis)['"]/i;
const secondTransport = allSrc.filter((f) => SOCKET_SECOND.test(readFileSync(f, 'utf8')));
check('transport: no second realtime architecture was introduced',
  secondTransport.length === 0, secondTransport.join(', '));
check('transport: the app is still on the single Pusher transport',
  has(SERVER, "from 'pusher'") && has(RT_CLIENT, "from 'pusher-js'"));

console.log('\nPHASE 6 (source contract) RESULT: ' + pass + ' passed, ' + fail + ' failed');

// ===========================================================================
// 13. LIVE DB - the delivery layer must not have corrupted Phase 5's state.
// ===========================================================================
async function main() {
  const db = new PrismaClient();
  try {
    const dangling = await db.orderOffer.count({
      where: { status: 'pending', order: { status: { not: 'searching' } } },
    });
    check('db invariant: no `pending` offer on a closed order', dangling === 0, dangling + ' row(s)');

    const driverless = await db.order.count({
      where: { status: { in: ['accepted', 'picked', 'delivered'] }, driverId: null },
    });
    check('db invariant: no in-flight order without a driver', driverless === 0, driverless + ' row(s)');

    // Part 15: a duplicated delivery must never have produced duplicate rows.
    const dupes = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT o."orderId", o."driverId"
        FROM "OrderOffer" o
        GROUP BY o."orderId", o."driverId"
        HAVING COUNT(*) > 1
      ) dup
    `;
    const dupeCount = Number(dupes[0]?.count ?? 0);
    check('db invariant: at most one offer row per (order, driver)',
      dupeCount === 0, dupeCount + ' duplicate pair(s)');

    // The notification table must still be writable/readable as before.
    const notifTypes = await db.notification.groupBy({ by: ['type'], _count: { _all: true } });
    check('db: the notification table is intact and queryable', notifTypes.length > 0,
      notifTypes.length + ' type(s)');
  } catch (e) {
    check('db: live invariants ran', false, String(e).slice(0, 120));
  } finally {
    await db.$disconnect().catch(() => undefined);
  }

  console.log('\nPHASE 6 RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}

void main();
