// ---------------------------------------------------------------------------
// C4 — WASSILHA realtime, powered by Pusher (managed websockets).
//
// This replaces the previous in-process socket.io server (REALTIME_PORT 3003).
// The socket.io design could not survive the Vercel serverless deploy — a
// Next.js function may be frozen between invocations, so the extra HTTP
// listener died and live tracking silently went dark. Pusher is a hosted
// websocket fan-out service, so a trigger is fire-and-forget and works from
// any function instance.
//
// Server-side only. Import this from API routes / server components; never
// bundle it into the client (it holds the app secret).
//
// FAIL-SAFE: the app degrades gracefully when Pusher is unconfigured — every
// helper no-ops with a warning instead of throwing, so a missing/typo'd env
// var breaks realtime but never breaks order creation or location updates.
// ---------------------------------------------------------------------------

import Pusher from 'pusher';
import type { Order, RealtimeOfferEvent } from './types';

/**
 * The Prisma schema stores `cargoType` / `status` as plain `String` and the
 * timestamp columns as `DateTime`, while the shared `Order` type narrows the
 * strings to `CargoKey` / `OrderStatus` and expects ISO strings (the shape the
 * browser receives, since NextResponse.json serialises Date → ISO).
 *
 * `serialiseOrder` reconciles the two for every emitter: it maps the Prisma row
 * to exactly the payload the API route already returns, so a client receiving
 * a Pusher event sees the identical object it would have seen from the REST
 * route. Only the timestamp fields are converted at runtime; the string
 * columns pass through unchanged.
 */
// Date-typed columns from the Prisma row.
const ORDER_DATE_KEYS = [
  'createdAt',
  'acceptedAt',
  'pickedAt',
  'deliveredAt',
  'cancelledAt',
  'scheduledAt',
] as const;

/**
 * A Prisma order row. The schema declares no enums and the relations recurse
 * into User (also enum-free), so the Prisma payload diverges from the shared
 * `Order` type in several nested places at once — too many to enumerate by
 * hand without drifting from the schema. We therefore accept the row loosely
 * and normalise it via `serialiseOrder`, which only touches the timestamp
 * columns (the fields clients actually parse as dates).
 */
type PrismaOrderRow = Record<string, unknown>;

/**
 * Map the Prisma row to exactly the payload the API route already returns, so
 * a client receiving a Pusher event sees the identical object it would have
 * seen from the REST route (NextResponse.json serialises Date → ISO).
 */
function serialiseOrder(row: PrismaOrderRow): Order {
  const out: Record<string, unknown> = { ...row };
  for (const key of ORDER_DATE_KEYS) {
    const v = out[key];
    out[key] = v instanceof Date ? v.toISOString() : (v ?? null);
  }
  return out as unknown as Order;
}

let instance: Pusher | null = null;
let warned = false;

// Lazily build the client. Returns null when the env vars are missing so every
// helper can no-op instead of crashing the request that called it.
function pusherClient(): Pusher | null {
  if (instance) return instance;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    if (!warned) {
      warned = true;
      console.warn(
        '[pusher] PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET / PUSHER_CLUSTER ' +
          'are not set — realtime events will be dropped. Order state is still ' +
          'persisted in the DB; clients recover on the next poll/refetch.',
      );
    }
    return null;
  }

  instance = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
  return instance;
}

// ---------------------------------------------------------------------------
// Channel naming.
//
// All channels are PRIVATE: Pusher refuses to subscribe to `private-*` without
// a signature from this server (see /api/pusher/auth), so a user can only open
// a channel we have explicitly authorised for their session. The old socket.io
// server achieved the same with a session check on connect.
//
//   private-order-<orderId>   customer + assigned driver (live tracking + status)
//   private-driver-<userId>   driver's personal feed (incoming requests + bids)
//   private-user-<userId>     any role's personal feed (notification center)
//   private-admin             admin fleet / dashboard feed
// ---------------------------------------------------------------------------

export function orderChannel(orderId: string): string {
  return `private-order-${orderId}`;
}

export function driverChannel(userId: string): string {
  return `private-driver-${userId}`;
}

// PHASE 6 - the per-user channel behind the realtime notification badge.
//
// Drivers have had `private-driver-<id>` since C4, but customers had no personal
// channel at all (they only ever joined an order channel), so a customer's bell
// could only ever be polled. One channel per user, authorised in
// /api/pusher/auth by an exact id match, keeps the isolation property: a
// signed-in user can only ever open their OWN feed.
export function userChannel(userId: string): string {
  return `private-user-${userId}`;
}

const ADMIN_CHANNEL = 'private-admin';

// Event names.
//
// The three lifecycle names below are unchanged since C4, so the migration
// stayed invisible to clients. PHASE 6 adds the negotiation + notification half
// of the vocabulary:
//
//   order:new-request  (kept)  a now-live order, fanned out to ELIGIBLE drivers
//   order:status       (kept)  an order row changed state
//   driver:location    (kept)  a GPS fix, on the order + admin channels
//   offer:new          (new)   a driver bid - the order's CUSTOMER only
//   offer:update       (new)   a bid changed state - that ONE driver only
//   notification:new   (new)   a notification row - that ONE user only
//
// `order:update` was RETIRED here: it had zero emitter call sites and the admin
// channel already receives `order:status` for every order change, so the admin
// screens bind that instead of a second, never-fired event.
export const EVENTS = {
  ORDER_NEW_REQUEST: 'order:new-request',
  ORDER_STATUS: 'order:status',
  DRIVER_LOCATION: 'driver:location',
  OFFER_NEW: 'offer:new',
  OFFER_UPDATE: 'offer:update',
  NOTIFICATION_NEW: 'notification:new',
} as const;

// Fire a trigger without throwing. Logging only — the DB write that preceded
// the trigger is the source of truth, so a dropped push means the customer
// sees the update one poll later, never a stuck order.
function safeTrigger(channels: string[], event: string, data: unknown): void {
  const client = pusherClient();
  if (!client) return;
  try {
    void client.trigger(channels, event, data).catch((e) => {
      console.warn(`[pusher] trigger ${event} failed:`, String(e));
    });
  } catch (e) {
    console.warn(`[pusher] trigger ${event} failed:`, String(e));
  }
}

// ---------------------------------------------------------------------------
// Server emitters.
//
// These mirror the socket.io "relay" behaviour, but the emit moves from the
// client to the server for correctness: the caller already fetched the
// authoritative `order` row from the DB, so it owns the payload. Under
// socket.io a driver would POST the status change and then separately emit the
// full order over the socket — a client that missed the emit kept a stale view
// until the next poll.
// ---------------------------------------------------------------------------

/**
 * Broadcast an incoming order request to the drivers eligible to see it.
 * `driverUserIds` is the fan-out list computed by dispatch.ts; we trigger one
 * driver channel per recipient (Pusher accepts up to 100 channels per call).
 */
export function emitOrderNewRequest(row: PrismaOrderRow, driverUserIds: string[]): void {
  if (driverUserIds.length === 0) return;
  safeTrigger(
    driverUserIds.map(driverChannel),
    EVENTS.ORDER_NEW_REQUEST,
    { order: serialiseOrder(row) },
  );
}

/**
 * Broadcast a status change (accepted/picked/delivered/cancelled) to the
 * customer, the assigned driver, and the admin feed in a single trigger.
 */
export function emitOrderStatus(row: PrismaOrderRow): void {
  const order = serialiseOrder(row);
  const channels = [orderChannel(order.id), ADMIN_CHANNEL];
  if (order.customerId) channels.push(driverChannel(order.customerId));
  if (order.driverId) channels.push(driverChannel(order.driverId));
  safeTrigger(channels, EVENTS.ORDER_STATUS, { order });
}

// ---------------------------------------------------------------------------
// PHASE 6 - negotiation + notification emitters.
//
// AUDIENCE (enforced twice: here, and again in /api/pusher/auth when the client
// asks to join the channel):
//
//   offer:new        -> the order's CUSTOMER   (order channel)
//   offer:update     -> the ONE driver who owns the bid (that driver's channel)
//   notification:new -> the ONE user the row belongs to (that user's channel)
//
// A bid is NEVER broadcast to the fleet: the competing prices are private to
// the customer comparing them, and no driver may read another driver's
// negotiation. Payloads carry no phone number, token, OTP or coordinates.
//
// Part 3 (emit-after-commit): every caller below runs AFTER the DB write (or
// the `$transaction`) has succeeded. A rolled-back write emits nothing, because
// the route returns before reaching these calls.
// ---------------------------------------------------------------------------

/** Input for one negotiation event. Mirrors the fields a client renders. */
export interface OfferEmitInput {
  kind: RealtimeOfferEvent['kind'];
  offerId: string;
  orderId: string;
  orderCode: string;
  /** The User id of the driver who owns the bid (drives channel selection). */
  driverId: string;
  driverName?: string | null;
  price: number;
  /** `OrderOffer.status` after the write. */
  status: string;
  counterPrice?: number | null;
}

// Bounded fan-out. An order with more live bids than this still settles
// correctly (the DB already rejected them); the remaining UIs converge on their
// next poll instead of us firing an unbounded number of Pusher triggers.
const MAX_OFFER_FAN_OUT = 20;

function offerPayload(input: OfferEmitInput): RealtimeOfferEvent {
  return {
    kind: input.kind,
    offerId: input.offerId,
    orderId: input.orderId,
    orderCode: input.orderCode,
    driverId: input.driverId,
    driverName: input.driverName ?? null,
    price: input.price,
    status: input.status,
    counterPrice: input.counterPrice ?? null,
    at: new Date().toISOString(),
  };
}

/** A new bid arrived on an order - the customer watching it is notified. */
export function emitOfferNew(input: OfferEmitInput): void {
  safeTrigger([orderChannel(input.orderId)], EVENTS.OFFER_NEW, offerPayload(input));
}

/**
 * A bid changed state (countered / accepted / rejected) - delivered to the
 * driver who owns it, on their personal channel.
 *
 * `opts.alsoOrder` additionally mirrors the event onto the ORDER channel when
 * the CUSTOMER is the actor (a counter or a decline). That is what makes the
 * customer's second tab / a stale tab converge without a refetch - and it stays
 * safe, because the order channel is only signable by that order's customer,
 * its assigned driver and an admin. The fleet is never a destination.
 */
export function emitOfferUpdateToDriver(
  input: OfferEmitInput,
  opts?: { alsoOrder?: boolean },
): void {
  const channels = [driverChannel(input.driverId)];
  if (opts?.alsoOrder) channels.push(orderChannel(input.orderId));
  safeTrigger(channels, EVENTS.OFFER_UPDATE, offerPayload(input));
}

/**
 * Tell every losing bidder their bid is dead after an award or a cancellation.
 *
 * `safeTrigger` is fire-and-forget, so this loop adds no latency to the
 * customer's response. The list is capped (MAX_OFFER_FAN_OUT) to bound the
 * number of triggers a single hot order can generate.
 */
export function emitOfferSettledToLosers(
  losers: Array<{ id: string; driverId: string; price: number }>,
  order: { id: string; code: string },
): void {
  for (const loser of losers.slice(0, MAX_OFFER_FAN_OUT)) {
    emitOfferUpdateToDriver({
      kind: 'rejected',
      offerId: loser.id,
      orderId: order.id,
      orderCode: order.code,
      driverId: loser.driverId,
      price: loser.price,
      status: 'rejected',
      counterPrice: null,
    });
  }
}

/**
 * A notification row was committed for exactly this user.
 *
 * Called from `createNotification()` (the single write path), so every existing
 * emitter - order accepted, offer received, counter, delivery, approvals -
 * reaches the bell live without touching its call site.
 */
export function emitNotificationNew(userId: string, notification: unknown): void {
  safeTrigger([userChannel(userId)], EVENTS.NOTIFICATION_NEW, { notification });
}

/**
 * Broadcast a live GPS fix for the driver currently fulfilling `orderId`.
 * Called from POST /api/driver/location. `orderId` must be validated by the
 * caller (the route already confirms the driver is the assigned one) — the
 * private channel signature only proves *who* is listening, not that the
 * poster is the assigned driver.
 */
export function emitDriverLocation(
  orderId: string,
  lat: number,
  lng: number,
  driverId: string,
): void {
  // Also fan out to the admin channel so the fleet map tracks active drivers
  // without a second trigger.
  safeTrigger(
    [orderChannel(orderId), ADMIN_CHANNEL],
    EVENTS.DRIVER_LOCATION,
    { orderId, lat, lng, driverId },
  );
}

