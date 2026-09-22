// ---------------------------------------------------------------------------
// C4 — Backwards-compatible realtime relay, now backed by Pusher.
//
// `realtime-server.ts` re-exports these so its two historical importers keep
// compiling and working:
//
//   ensureRealtime()           — was "boot the socket.io server". There is
//                                nothing to boot with a hosted websocket
//                                service, so this is a no-op that stays as a
//                                harmless boot hint.
//   broadcastDriverLocation()  — fans a GPS fix out to the order channel.
//                                Now calls pusher-server.emitDriverLocation.
//
// Keeping the indirection in this file (instead of pointing callers straight
// at pusher-server) is deliberate: it lets the two API routes stay untouched,
// and gives us one place to keep the old names alive while the rest of the
// codebase migrates.
// ---------------------------------------------------------------------------

import { emitDriverLocation } from './pusher-server';

/**
 * No-op under Pusher.
 *
 * With socket.io this had to attach an HTTP listener to the Next.js process
 * before any client could connect, and it was called from /api/auth/me as a
 * boot hint. Pusher connections are opened lazily by `pusher-js` on the first
 * subscription and authenticated per-channel by /api/pusher/auth, so there is
 * no server-side process to start. The call is kept in the routes for safety
 * (harmless) and to preserve the "first API call warms realtime" contract.
 */
export function ensureRealtime(): void {
  // Intentionally empty — hosted websockets need no boot.
}

/**
 * Broadcast a driver GPS fix to every client subscribed to the order.
 *
 * Called from POST /api/driver/location after the fix is persisted on the
 * Driver row. Under socket.io this emitted to the `order:<id>` room; now it
 * triggers the `driver:location` event on `private-order-<id>` (and the admin
 * feed) via pusher-server. Pusher signing guarantees only the order's customer
 * and assigned driver can receive it.
 *
 * Never throws: the persisted position is the source of truth, and the next
 * client poll recovers if the trigger is dropped.
 */
export function broadcastDriverLocation(
  orderId: string,
  lat: number,
  lng: number,
  driverId: string,
): void {
  emitDriverLocation(orderId, lat, lng, driverId);
}
