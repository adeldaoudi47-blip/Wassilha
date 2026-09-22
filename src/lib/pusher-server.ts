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
import type { Order } from './types';

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
//   private-driver-<userId>   driver's personal feed (incoming requests)
//   private-admin             admin fleet / dashboard feed
// ---------------------------------------------------------------------------

export function orderChannel(orderId: string): string {
  return `private-order-${orderId}`;
}

export function driverChannel(userId: string): string {
  return `private-driver-${userId}`;
}

const ADMIN_CHANNEL = 'private-admin';

// Event names. Kept identical to the socket.io names so the migration is
// invisible to any client code that already binds on the string form.
export const EVENTS = {
  ORDER_NEW_REQUEST: 'order:new-request',
  ORDER_STATUS: 'order:status',
  ORDER_UPDATE: 'order:update',
  DRIVER_LOCATION: 'driver:location',
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

/**
 * Admin-facing aggregated update (same payload as emitOrderStatus, different
 * channel binding for components that listen on the admin feed).
 */
export function emitOrderUpdate(row: PrismaOrderRow): void {
  safeTrigger([ADMIN_CHANNEL], EVENTS.ORDER_UPDATE, { order: serialiseOrder(row) });
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

