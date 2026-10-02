// PHASE 5 verification (Production Hardening: authorization, race conditions,
// state and price integrity).
//
// The repo has no JS test framework, so - exactly like verify-phase1/2/4 -
// this file IS the "tests" gate for the phase. Phase 5 introduced no new engine
// and no schema change: it hardened the WRITE PATHS around the Phase 1-4
// engines. So the checks come in three flavours:
//
//   1. SOURCE CONTRACTS - the atomicity / authorization / price properties
//      each hardened route must keep holding, asserted against the real files
//      on disk (a refactor that silently drops a guard fails here),
//   2. SHARED POLICY - the truth sources the routes now agree on
//      (`isVehicleCompatible`, `serviceCategoryFor`, `canDriverOfferOnOrder`),
//   3. LIVE DB INVARIANTS - the cross-row states Phase 5 exists to prevent
//      (a `pending` bid on a closed order, an assigned-but-driverless order,
//      an agreed price on a still-searching order, ...).
//
// Run with: bun src/scripts/verify-phase5.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { isVehicleCompatible, serviceCategoryFor } from '../lib/dispatch';
import { translations } from '../lib/i18n';
import {
  canDriverOfferOnOrder,
  type OfferOrderFacts,
  type OfferDriverFacts,
} from '../lib/offer-policy';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) pass++;
  else fail++;
  console.log(`[${tag}] ${name}${extra ? ` - ${extra}` : ''}`);
}

// Source access: every contract below is asserted against the file that ships.
function src(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

function has(body: string, needle: string): boolean {
  return body.includes(needle);
}

// Ordering helper: "the guard runs before the write" is part of a contract, and
// this is how that is expressed against source text.
function before(body: string, first: string, second: string): boolean {
  const a = body.indexOf(first);
  const b = body.indexOf(second);
  return a !== -1 && b !== -1 && a < b;
}

const AWARD = 'src/app/api/orders/[id]/offers/[offerId]/accept/route.ts';
const ACCEPT = 'src/app/api/orders/[id]/accept/route.ts';
const COUNTER = 'src/app/api/orders/[id]/offers/[offerId]/counter/route.ts';
const OFFERS = 'src/app/api/orders/[id]/offers/route.ts';
const CANCEL = 'src/app/api/orders/[id]/cancel/route.ts';
const PICKUP = 'src/app/api/orders/[id]/pickup/route.ts';
const DELIVER = 'src/app/api/orders/[id]/deliver/route.ts';
const RATE = 'src/app/api/orders/[id]/rate/route.ts';
const REJECT = 'src/app/api/orders/[id]/reject/route.ts';
const LOCATION = 'src/app/api/driver/location/[driverId]/route.ts';
const UPLOAD = 'src/app/api/uploads/order-image/route.ts';
const STATS = 'src/app/api/admin/stats/route.ts';

const award = src(AWARD);
const accept = src(ACCEPT);
const counter = src(COUNTER);
const offers = src(OFFERS);
const cancel = src(CANCEL);

// ---------------------------------------------------------------------------
// 1. OFFER AWARD (/offers/[offerId]/accept) - one transaction, full re-gate.
// ---------------------------------------------------------------------------
check('award: claim + settlement + journal run in ONE $transaction',
  has(award, 'const awarded = await db.$transaction(async (tx) => {'));
check('award: claim is guarded on searching + unassigned + owning customer',
  has(award, "status: 'searching',") && has(award, 'driverId: null,') && has(award, 'customerId: session.id,'));
check('award: agreed price is stamped on the order (finalPrice)',
  has(award, 'finalPrice: offer.price,'));
check('award: winner offer is flipped only while still pending',
  has(award, "where: { id: offer.id, status: 'pending' },"));
check('award: losing pending offers are auto-rejected',
  has(award, "data: { status: 'rejected' },") && has(award, 'id: { not: offer.id },'));
check('award: settlement journal is written INSIDE the transaction',
  has(award, 'await tx.offerEvent.createMany({'));
check('award: journal is no longer fire-and-forget (void db.offerEvent gone)',
  !has(award, 'void db.offerEvent'));
check('award: zero-row claim aborts with 409 notAvailable',
  has(award, 'if (!awarded) {') && has(award, "error: 'notAvailable'"));
check('award: service-type gate re-checks the same policy as the bid path',
  has(award, 'serviceCategoryFor(offer.order.cargoType)') &&
  has(award, "offeringDriver.serviceType !== requiredService"));
check('award: driver eligibility (verified + active) re-checked at award time',
  has(award, "!offeringDriver.isVerified || offeringDriver.applicationStatus !== 'active'"));
check('award: vehicle compatibility re-checked at award time',
  has(award, 'isVehicleCompatible('));
check('award: every gate runs BEFORE the transaction opens',
  before(award, 'isVehicleCompatible(', 'db.$transaction(') &&
  before(award, 'serviceCategoryFor(', 'db.$transaction(') &&
  before(award, "offer.status !== 'pending'", 'db.$transaction('));
check('award: response carries the settled (accepted) offer row, not the stale snapshot',
  has(award, 'const settledOffer =') && has(award, 'offer: settledOffer'));

// ---------------------------------------------------------------------------
// 2. FLAT ACCEPT (/accept) - same gates as bidding, plus the bid cleanup.
// ---------------------------------------------------------------------------
check('accept: claim + bid cleanup run in ONE $transaction',
  has(accept, 'const claimed = await db.$transaction(async (tx) => {'));
check('accept: claim keeps the V4 guard (searching + unassigned)',
  has(accept, "where: { id, status: 'searching', driverId: null },"));
check('accept: account-state gate (verified + active) exists',
  has(accept, "!driver.isVerified || driver.applicationStatus !== 'active'"));
check('accept: service-type gate uses the shared serviceCategoryFor policy',
  has(accept, 'serviceCategoryFor(order.cargoType)') &&
  has(accept, "driver.serviceType !== requiredService"));
check('accept: driver profile is resolved BEFORE the order (no order-id probing)',
  before(accept, 'where: { userId: session.id }', 'where: { id }'));
check('accept: pending bids on the claimed order are rejected in the same tx',
  has(accept, "where: { orderId: id, status: 'pending' },") &&
  has(accept, "data: { status: 'rejected' },"));
check('accept: rejections are journalled atomically (tx.offerEvent.createMany)',
  has(accept, 'await tx.offerEvent.createMany({'));
check('accept: zero-row claim aborts with 409 notAvailable',
  has(accept, 'if (!claimed) {') && has(accept, "error: 'notAvailable'"));
check('accept: vehicle compatibility gate still enforced',
  has(accept, 'isVehicleCompatible(order, driver.vehicleRegistration)'));

// ---------------------------------------------------------------------------
// 3. COUNTER (/offers/[offerId]/counter) - the order must still be open.
// ---------------------------------------------------------------------------
check('counter: order-state pre-check exists (searching + unassigned)',
  has(counter, "offer.order.status !== 'searching' || offer.order.driverId !== null"));
check('counter: order-state rejection is a specific 409 orderNotSearchable',
  has(counter, "error: 'orderNotSearchable'"));
check('counter: re-read + offer update + journal share ONE $transaction',
  has(counter, 'const outcome = await db.$transaction(async (tx) => {') &&
  has(counter, 'const live = await tx.order.findUnique({') &&
  has(counter, 'await tx.orderOffer.updateMany({'));
check('counter: inside the transaction the order is re-read BEFORE the offer write',
  before(counter, 'const live = await tx.order.findUnique({',
    'const updated = await tx.orderOffer.updateMany({'));
check('counter: offer update keeps its pending precondition',
  has(counter, "where: { id: offer.id, status: 'pending' },") &&
  has(counter, "data: { status: 'countered', counterPrice: price },"));
check('counter: journal is written inside the transaction, not fire-and-forget',
  has(counter, 'await tx.offerEvent.create({') && !has(counter, 'void db.offerEvent'));
check('counter: both failure modes still answer a specific 409',
  has(counter, "return 'orderNotSearchable' as const;") &&
  has(counter, "return 'offerNotPending' as const;"));

// ---------------------------------------------------------------------------
// 4. BID CREATION (/offers) - the check-then-upsert race is closed.
// ---------------------------------------------------------------------------
check('offers: the guarded order write takes the row lock before the upsert',
  has(offers, 'const stillOpen = await tx.order.updateMany({') &&
  before(offers, 'const stillOpen = await tx.order.updateMany({',
    'const row = await tx.orderOffer.upsert({'));
check('offers: the lock re-asserts searching + unassigned',
  has(offers, "where: { id: order.id, status: 'searching', driverId: null },"));
check('offers: a closed order yields 409 notAvailable, no dangling bid',
  has(offers, 'if (!offer) {') && has(offers, "error: 'notAvailable'"));
check('offers: upsert + journal share one transaction',
  has(offers, 'const offer = await db.$transaction(async (tx) => {') &&
  has(offers, 'await tx.offerEvent.create({') && !has(offers, 'void db.offerEvent'));
check('offers: re-offering clears the superseded counter price',
  has(offers, 'counterPrice: null,'));
check('offers: the Phase 4 journal row is still produced (review timeline kept)',
  has(offers, "type: 'driver_offer', price"));

// ---------------------------------------------------------------------------
// 5. CANCEL (/cancel) - guarded write + negotiation cleanup, atomically.
// ---------------------------------------------------------------------------
check('cancel: write is a conditional updateMany (terminal statuses excluded)',
  has(cancel, "where: { id, status: { notIn: ['delivered', 'cancelled'] } },"));
check('cancel: no unguarded order.update() remains',
  !has(cancel, 'const updated = await db.order.update({'));
check('cancel: cancel + bid cleanup share ONE $transaction',
  has(cancel, 'const updated = await db.$transaction(async (tx) => {'));
check('cancel: pending bids are rejected and journalled in the same tx',
  has(cancel, "data: { status: 'rejected' },") && has(cancel, 'await tx.offerEvent.createMany({'));
check('cancel: zero-row write returns 409 invalidStatus (race lost, nothing written)',
  has(cancel, 'if (!updated) {') && has(cancel, "error: 'invalidStatus'"));
check('cancel: authorization (owner / assigned driver / admin) still enforced',
  has(cancel, 'const isOwner = order.customerId === session.id;') &&
  has(cancel, 'const isAssignedDriver =') && has(cancel, "session.role === 'admin'"));

// ---------------------------------------------------------------------------
// 6. DRIVER LOCATION (/driver/location/[driverId]) - live trip only.
// ---------------------------------------------------------------------------
const location = src(LOCATION);
check('location: customer access requires an ACTIVE order (accepted/picked)',
  has(location, "status: { in: ['accepted', 'picked'] },"));
check('location: historical shared orders no longer grant GPS access',
  !has(location, 'const shared = await db.order.findFirst({'));
check('location: driver self-read and admin bypass still work',
  has(location, "driver.userId !== session.id && session.role !== 'admin'"));

// ---------------------------------------------------------------------------
// 7. UPLOAD (/uploads/order-image) - MIME + size + name defence in depth.
//
// PHASE 8: the allow-lists moved from this route into src/lib/image-upload.ts
// (shared with /api/craft/upload so the two cannot drift). The properties the
// route itself must still hold are: it delegates to the shared validator, it
// rejects before any Blob write, and it does not resurrect a local allow-list.
// The shared module's contents (raster-only MIME, 5MB cap, ext sanitisation,
// filename never reaching the key) are verified by verify-phase8.ts, which
// EXECUTES the real helper.
// ---------------------------------------------------------------------------
const upload = src(UPLOAD);
check('upload: validation is delegated to the shared image-upload validator',
  has(upload, "validateImageUpload(file)") &&
  has(upload, "buildImageKey('orders', session.id, result.ext)"));
check('upload: no local allow-list was resurrected in the route',
  !has(upload, 'ALLOWED_MIME') && !has(upload, 'ALLOWED_EXT') &&
  !has(upload, 'ALLOWED_IMAGE_MIME') && !has(upload, 'ALLOWED_IMAGE_EXT'));
check('upload: the blob is written only AFTER validation accepts the file',
  before(upload, 'validateImageUpload(file)', 'put(') &&
  has(upload, 'if (!result.ok) {') &&
  has(upload, "status: 400 }") &&
  upload.indexOf('put(') > upload.indexOf("status: 400 }"));
check('upload: error responses never echo the exception detail',
  !has(upload, 'detail: String(e)') && !has(upload, 'detail: e'));

// ---------------------------------------------------------------------------
// 8. PRICE INTEGRITY - `finalPrice ?? price` on EVERY money surface.
//
// A negotiated order has two numbers: `price` (the original estimate) and
// `finalPrice` (what was actually agreed). Any surface that shows or sums the
// first one after a deal has been struck contradicts the receipt. Phase 4
// covered the live screens; Phase 5 closed the four that were missed.
// ---------------------------------------------------------------------------
function occurrences(body: string, needle: string): number {
  return body.split(needle).length - 1;
}

const priceSurfaces: Array<[string, string, string]> = [
  ['customer history list', 'src/components/wassilha/customer/customer-history.tsx', 'finalPrice ?? o.price'],
  ['admin orders table', 'src/components/wassilha/admin/admin-orders.tsx', 'finalPrice ?? o.price'],
  ['customer profile spend', 'src/components/wassilha/customer/customer-profile.tsx', '(o.finalPrice ?? o.price)'],
  ['admin stats revenue', 'src/app/api/admin/stats/route.ts', 'o.finalPrice ?? o.price'],
  ['customer tracking receipt', 'src/components/wassilha/customer/customer-track.tsx', 'finalPrice ?? order.price'],
  ['driver active trip', 'src/components/wassilha/driver/active-trip.tsx', 'active.finalPrice ??'],
  ['driver earnings list', 'src/components/wassilha/driver/driver-earnings.tsx', 'o.finalPrice ??'],
  ['driver trips list', 'src/components/wassilha/driver/driver-trips.tsx', 'o.finalPrice ??'],
];

for (const [label, rel, needle] of priceSurfaces) {
  check(`price integrity: ${label} uses the agreed price`, has(src(rel), needle));
}

check('price integrity: admin stats sums finalPrice for total AND per-day series',
  has(src(STATS), 'finalPrice: true') && occurrences(src(STATS), 'o.finalPrice ?? o.price') >= 2);
check('price integrity: no money surface still quotes the raw estimate',
  !has(src('src/components/wassilha/customer/customer-history.tsx'), 'formatDzd(o.price)') &&
  !has(src('src/components/wassilha/admin/admin-orders.tsx'), 'formatDzd(o.price)') &&
  !has(src('src/components/wassilha/customer/customer-profile.tsx'), 's + o.price') &&
  !has(src(STATS), 's + o.price'));

// ---------------------------------------------------------------------------
// 9. SHARED POLICY - the truth sources the hardened routes now agree on.
// ---------------------------------------------------------------------------
check("serviceCategoryFor('taxi') => TAXI", serviceCategoryFor('taxi') === 'TAXI');
check("serviceCategoryFor('parcel') => CARGO", serviceCategoryFor('parcel') === 'CARGO');
check("serviceCategoryFor('person') => CARGO", serviceCategoryFor('person') === 'CARGO');

const gateOrder: OfferOrderFacts = {
  status: 'searching',
  customerId: 'customer-1',
  driverId: null,
  cargoType: 'parcel',
  isNegotiable: true,
  cargoSize: 'small',
  requiredVehicleType: null,
  requiredSeats: null,
};
const gateDriver: OfferDriverFacts = {
  id: 'driver-1',
  isVerified: true,
  applicationStatus: 'active',
  serviceType: 'CARGO',
  vehicleCategory: 'moto',
  seats: 1,
};

check('policy: CARGO-service, verified, compatible driver is allowed to bid',
  canDriverOfferOnOrder(gateOrder, gateDriver).ok === true);
check('policy: TAXI-only driver is denied on a cargo order',
  (() => {
    const res = canDriverOfferOnOrder(gateOrder, { ...gateDriver, serviceType: 'TAXI' });
    return !res.ok && res.reason === 'serviceTypeMismatch';
  })());
check('policy: unverified driver is denied',
  (() => {
    const res = canDriverOfferOnOrder(gateOrder, { ...gateDriver, isVerified: false });
    return !res.ok && res.reason === 'notVerified';
  })());
check('policy: suspended application is denied',
  (() => {
    const res = canDriverOfferOnOrder(gateOrder, { ...gateDriver, applicationStatus: 'pending' });
    return !res.ok && res.reason === 'driverNotActive';
  })());
check('policy: a closed (non-searchable) order is denied',
  (() => {
    const res = canDriverOfferOnOrder({ ...gateOrder, status: 'accepted' }, gateDriver);
    return !res.ok && res.reason === 'orderNotSearchable';
  })());
check('policy: Phase 4 vehicle rule preserved (large cargo + moto)',
  isVehicleCompatible({ cargoSize: 'large' }, { vehicleCategory: 'moto' }) === false);
check('policy: Phase 1 seat rule preserved (7 seats needed, 5-seater offered)',
  isVehicleCompatible({ requiredSeats: 7 }, { vehicleCategory: 'taxi_car_5', seats: 5 }) === false);
check('policy: legacy constraint-free order stays compatible',
  isVehicleCompatible({}, null) === true);

// A new server-side refusal is useless if the app cannot explain it: the two
// gates the accept path gained must be readable in both locales, and the
// driver's request card must map them.
for (const key of ['serviceTypeMismatch', 'driverNotEligible'] as const) {
  check(`i18n: ${key} exists in ar and fr`,
    typeof translations.ar[key] === 'string' && translations.ar[key].length > 0 &&
    typeof translations.fr[key] === 'string' && translations.fr[key].length > 0);
}
const driverRequests = src('src/components/wassilha/driver/driver-requests.tsx');
check('ui: the accept handler explains serviceTypeMismatch',
  has(driverRequests, 't.serviceTypeMismatch'));
check('ui: the accept handler explains driverNotEligible',
  has(driverRequests, 't.driverNotEligible'));

// ---------------------------------------------------------------------------
// 10. STATE MACHINE - every transition is a guarded, atomic write.
//    searching -> accepted | cancelled
//    accepted  -> picked     | cancelled
//    picked    -> delivered  | cancelled
//    delivered / cancelled   -> terminal (rate may still land on delivered)
// ---------------------------------------------------------------------------
const pickup = src(PICKUP);
const deliver = src(DELIVER);
const rate = src(RATE);
const reject = src(REJECT);

check('state machine: pickup is guarded on accepted + assigned driver',
  has(pickup, "where: { id, status: 'accepted', driverId: session.id },") &&
  has(pickup, "data: { status: 'picked', pickedAt: new Date() },"));
check('state machine: deliver is guarded on picked + assigned driver',
  has(deliver, "where: { id, status: 'picked', driverId: session.id },") &&
  has(deliver, "data: { status: 'delivered', deliveredAt: now },"));
check('state machine: pickup / deliver are driver-only',
  has(pickup, "session.role !== 'driver'") && has(deliver, "session.role !== 'driver'"));
check('state machine: a lost transition race is a 409, never a silent write',
  has(pickup, "error: 'invalidStatus'") && has(deliver, "error: 'invalidStatus'"));
check('state machine: rating requires a delivered order owned by the caller',
  has(rate, 'order.customerId !== session.id') && has(rate, "order.status !== 'delivered'"));
check('state machine: the rating score is bounded to 1..5',
  has(rate, 'score < 1 || score > 5') && has(rate, 'Number.isInteger(score)'));
check('state machine: driver reject stays a side-effect-free no-op',
  has(reject, "session.role !== 'driver'") && !has(reject, 'db.order.update'));
check('state machine: cancel refuses terminal orders on both the read and the write',
  has(cancel, "order.status === 'delivered' || order.status === 'cancelled'") &&
  has(cancel, "notIn: ['delivered', 'cancelled']"));

// ---------------------------------------------------------------------------
// 11. NO SECRET LEAKAGE in the hardened surface (defence in depth).
// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// A comment that names the stripped fields is documentation; what matters is
// that no query ever asks for them.
const secretSelects = ['passwordHash: true', 'include: { user: true', 'user: { select: { passwordHash'];
const hardenedRoutes = [AWARD, ACCEPT, COUNTER, OFFERS, CANCEL, LOCATION, UPLOAD, STATS];
for (const rel of hardenedRoutes) {
  check(`privacy: ${rel} never selects a credential field`,
    secretSelects.every((needle) => !has(src(rel), needle)));
}
for (const rel of [AWARD, ACCEPT, CANCEL, COUNTER, OFFERS]) {
  check(`privacy: ${rel} projects users through publicUserSelect`,
    has(src(rel), 'publicUserSelect'));
}
check('privacy: neither hardened status route returns a raw User relation',
  !has(award, 'include: { customer: true') && !has(accept, 'include: { customer: true') &&
  !has(cancel, 'include: { customer: true'));

const orderRouteFiles = walk(join(process.cwd(), 'src/app/api/orders'))
  .filter((p) => p.endsWith('route.ts'));
check('privacy: the order API tree was scanned', orderRouteFiles.length >= 10,
  `${orderRouteFiles.length} route files`);
check('privacy: no /api/orders route selects or includes a raw User row',
  orderRouteFiles.every((p) => {
    const body = readFileSync(p, 'utf8');
    return !body.includes('passwordHash: true') &&
      !body.includes('include: { customer: true') &&
      !body.includes('include: { driver: true') &&
      !body.includes('include: { user: true');
  }));

// ---------------------------------------------------------------------------
// 12. LIVE DB INVARIANTS - the cross-row states Phase 5 exists to prevent.
//
// These are the states the old code could commit and the new transactions
// cannot: a bid still `pending` on an order nobody can bid on any more, an
// order that is "assigned" to nobody, an agreed price on an order that was
// never awarded. A non-zero count means either the fix is incomplete or the
// database still carries rows from before it landed.
// ---------------------------------------------------------------------------
const db = new PrismaClient();

async function main(): Promise<void> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`[SKIP] database checks - DATABASE_URL unreachable: ${reason}`);
    await db.$disconnect().catch(() => undefined);
    console.log(`\nPHASE 5 RESULT: ${pass} passed, ${fail} failed (source + policy checks only)`);
    process.exit(fail > 0 ? 1 : 0);
  }

  // 12a. Schema surface the hardening relies on.
  try {
    await db.order.findFirst({
      select: { id: true, status: true, driverId: true, finalPrice: true, cargoSize: true, cargoImageUrl: true },
    });
    check('db: Order exposes status / driverId / finalPrice (award stamp)', true);
  } catch (err) {
    check('db: Order exposes status / driverId / finalPrice (award stamp)', false, String(err));
  }

  try {
    await db.orderOffer.findFirst({
      select: { id: true, orderId: true, driverId: true, status: true, price: true, counterPrice: true, updatedAt: true },
    });
    check('db: OrderOffer exposes status / counterPrice / updatedAt', true);
  } catch (err) {
    check('db: OrderOffer exposes status / counterPrice / updatedAt', false, String(err));
  }

  try {
    const events = await db.offerEvent.count();
    check('db: OfferEvent journal is queryable', typeof events === 'number');
  } catch (err) {
    check('db: OfferEvent journal is queryable', false, String(err));
  }

  // 12b. No dangling bid: a `pending` offer always belongs to a searching order.
  const danglingPending = await db.orderOffer.count({
    where: { status: 'pending', order: { status: { not: 'searching' } } },
  });
  check('db invariant: no `pending` offer on a closed order',
    danglingPending === 0, `${danglingPending} row(s)`);

  const danglingOnCancelled = await db.orderOffer.count({
    where: { status: 'pending', order: { status: 'cancelled' } },
  });
  check('db invariant: no `pending` offer on a cancelled order',
    danglingOnCancelled === 0, `${danglingOnCancelled} row(s)`);

  // 12c. Assignment integrity: an in-flight order always names its driver.
  const driverless = await db.order.count({
    where: { status: { in: ['accepted', 'picked', 'delivered'] }, driverId: null },
  });
  check('db invariant: no accepted/picked/delivered order without a driver',
    driverless === 0, `${driverless} row(s)`);

  // 12d. Price integrity: the agreed price only exists once the order is claimed.
  const priceWithoutClaim = await db.order.count({
    where: { status: 'searching', finalPrice: { not: null } },
  });
  check('db invariant: no `searching` order carries a finalPrice',
    priceWithoutClaim === 0, `${priceWithoutClaim} row(s)`);

  // 12e. Award integrity: an `accepted` offer is on an order assigned to it.
  // Expressed in raw SQL because it compares a column to a relation column,
  // which Prisma's query API cannot filter across.
  try {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "OrderOffer" o
      JOIN "Order" x ON x.id = o."orderId"
      WHERE o.status = 'accepted' AND (x."driverId" IS DISTINCT FROM o."driverId")
    `;
    const mismatched = Number(rows[0]?.count ?? 0);
    check('db invariant: every accepted offer matches its order assignment',
      mismatched === 0, `${mismatched} row(s)`);
  } catch (err) {
    check('db invariant: every accepted offer matches its order assignment', false, String(err));
  }

  // 12f. One live bid per driver per order (the @@unique the upsert keys on).
  const groups = await db.orderOffer.groupBy({ by: ['orderId', 'driverId'], _count: { _all: true } });
  const duplicates = groups.filter((g) => g._count._all > 1).length;
  check('db invariant: at most one offer row per (order, driver)',
    duplicates === 0, `${duplicates} duplicated pair(s)`);

  // 12g. Settlement integrity: no order is both delivered and still "live".
  const deliveredPending = await db.order.count({
    where: { status: 'delivered', deliveredAt: null },
  });
  check('db invariant: no delivered order without a deliveredAt timestamp',
    deliveredPending === 0, `${deliveredPending} row(s)`);

  await db.$disconnect().catch(() => undefined);
  console.log(`\nPHASE 5 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
}

void main();
