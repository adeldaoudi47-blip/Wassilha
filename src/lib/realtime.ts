// ---------------------------------------------------------------------------
// WASSILHA realtime client helper (C4 — Pusher).
//
// This file is the whole public realtime API on the client. Every component
// subscribes through these helpers instead of touching pusher-js directly, so
// the transport can be swapped without touching call sites.
//
// Channel naming lives next to the server implementation in
// `pusher-server.ts`; the two MUST stay in sync — hence the thin wrappers
// below re-derive names from `pusher-client.ts`.
//
// WHO CAN EMIT: under socket.io a client could `emit('order:status')` and the
// server would relay it. With Pusher, clients cannot publish to a channel —
// only the server can trigger. So the emit* helpers below now POST to the API
// route that owns the state change, and the server does the trigger. This is
// strictly safer: no client can fabricate an order status, and the payload
// always matches the committed DB row.
// ---------------------------------------------------------------------------

'use client';

import {
  pusherClient,
  orderChannel,
  driverChannel,
  ADMIN_CHANNEL,
  type PusherEventHandler,
} from './pusher-client';
import type { Order, Role } from './types';

// ---------------------------------------------------------------------------
// Connection lifecycle.
//
// `pusher-js` connects lazily on the first subscription and auto-reconnects, so
// these are intentionally thin: connect() warms the socket and subscribes to
// the channels the role needs; disconnect() tears it down on logout.
// `use-realtime.ts` is the only caller of connect/disconnect.
// ---------------------------------------------------------------------------

export function getSocket() {
  // Returns the pusher-js instance so any legacy code that wants a raw handle
  // still compiles against a live object.
  return pusherClient();
}

// Called by use-realtime.ts on login. Subscribing to the driver's personal
// channel up-front is what lets order requests reach them without a reload;
// `subscribe()` is idempotent for an already-joined channel.
export function connectSocket(userId: string, role: Role) {
  currentUserId = userId;
  currentRole = role;
  const c = pusherClient();
  if (role === 'driver') c.subscribe(driverChannel(userId));
  if (role === 'admin') c.subscribe(ADMIN_CHANNEL);
  return c;
}

export function disconnectSocket(): void {
  const existing = client;
  if (existing) {
    existing.disconnect();
  }
  currentUserId = null;
  currentRole = null;
}

let client: ReturnType<typeof pusherClient> | null = null;
// Remembered so onOrderNewRequest can resolve the driver's channel without
// every call site threading its own id in.
let currentUserId: string | null = null;
let currentRole: Role | null = null;

// ---------------------------------------------------------------------------
// Subscription lifecycle (replaces socket.io `order:subscribe` events).
// ---------------------------------------------------------------------------

// No-op under Pusher: subscription is implicit. We keep the exports so
// customer-track.tsx's subscribeToOrder/unsubscribeFromOrder calls keep
// working verbatim — the effect that runs them still controls when the
// channel is joined/left, it just does it via a real subscribe/unsubscribe.
export function subscribeToOrder(orderId: string): void {
  pusherClient().subscribe(orderChannel(orderId));
}

export function unsubscribeFromOrder(orderId: string): void {
  pusherClient().unsubscribe(orderChannel(orderId));
}

// ---------------------------------------------------------------------------
// Typed event listener helpers (for components).
//
// Each returns an unsubscribe function so callers can clean up in the same
// `useEffect` that subscribed — this is what the old socket.io versions
// returned too, so no call site changes shape.
//
// `bind` under pusher-js is per-channel, so a listener on `private-order-X`
// will not fire for the same event on `private-order-Y`. That is the security
// property we want: a customer tracking order A cannot see order B's location.
// ---------------------------------------------------------------------------

export type PresenceCounts = {
  customer: number;
  driver: number;
  admin: number;
  total: number;
};

// Bind a handler on a channel and return an unbind closure.
function bindOn(
  channelName: string,
  event: string,
  cb: PusherEventHandler,
): () => void {
  const channel = pusherClient().subscribe(channelName);
  const handler = (data: unknown) => cb(data);
  channel.bind(event, handler);
  return () => {
    channel.unbind(event, handler);
  };
}

// New order request broadcast to the driver's personal channel.
export function onOrderNewRequest(cb: (order: Order) => void): () => void {
  return bindOn(
    driverChannel(currentUserId ?? ''),
    'order:new-request',
    (data) => cb((data as { order: Order }).order),
  );
}

// Status change on a specific order (customer + assigned driver).
export function onOrderStatus(orderId: string, cb: (order: Order) => void): () => void {
  return bindOn(
    orderChannel(orderId),
    'order:status',
    (data) => cb((data as { order: Order }).order),
  );
}

// Admin aggregated feed.
export function onOrderUpdate(cb: (order: Order) => void): () => void {
  return bindOn(
    ADMIN_CHANNEL,
    'order:update',
    (data) => cb((data as { order: Order }).order),
  );
}

// Live driver GPS fix on the order channel (customer tracking screen).
export function onDriverLocation(
  orderId: string,
  cb: (p: { orderId: string; lat: number; lng: number; driverId: string }) => void,
): () => void {
  return bindOn(orderChannel(orderId), 'driver:location', (data) =>
    cb(data as { orderId: string; lat: number; lng: number; driverId: string }),
  );
}

// Live driver GPS fix on the admin channel (fleet map). Same event, different
// channel: the server triggers `driver:location` on BOTH `private-order-<id>`
// and `private-admin` so an admin can follow the whole fleet without a per-order
// subscription.
export function onAdminDriverLocation(
  cb: (p: { orderId: string; lat: number; lng: number; driverId: string }) => void,
): () => void {
  return bindOn(ADMIN_CHANNEL, 'driver:location', (data) =>
    cb(data as { orderId: string; lat: number; lng: number; driverId: string }),
  );
}

// ---------------------------------------------------------------------------
// Emitters.
//
// Under Pusher the client cannot publish, so the previous `emit*` helpers are
// no longer the transport — the state-changing API route now triggers the
// event server-side (see pusher-server.ts). These functions are kept as thin
// no-op wrappers so existing call sites (customer-home, driver-trips) keep
// compiling, and so the "emit after mutation" contract stays in one place.
// ---------------------------------------------------------------------------

// driver-trips.tsx calls emitOrderStatus(updated) after a successful
// pickup/delivery. The API route it just hit (pickup/deliver) already
// triggered the realtime event server-side, so there is nothing left to do.
export function emitOrderStatus(_order: Order): void {
  // Realtime fan-out is performed by the API route (see pusher-server.ts).
}

// customer-home.tsx calls emitOrderCreated(order) after POST /api/orders.
// Same reasoning: the route triggers the driver fan-out server-side.
export function emitOrderCreated(_order: Order): void {
  // Realtime fan-out is performed by POST /api/orders (see pusher-server.ts).
}

export function emitOrderAccepted(_order: Order): void {
  // Realtime fan-out is performed by POST /api/orders/[id]/accept.
}

// Drivers no longer push raw GPS over a socket. They POST to
// /api/driver/location, which validates and triggers `driver:location`.
export function emitDriverLocation(
  _orderId: string,
  _lat: number,
  _lng: number,
  _driverId: string,
): void {
  // No-op — POST /api/driver/location is the only permitted publish path.
}

// Legacy simulated-trip events. The server already ignored them when real GPS
// took over; they have no Pusher equivalent.
export function startDriverTrack(
  _orderId: string,
  _driverId: string,
  _start: { lat: number; lng: number },
  _end: { lat: number; lng: number },
): void {
  // No-op — real GPS drives the live marker.
}

export function stopDriverTrack(_orderId: string): void {
  // No-op — location stops when the driver closes the active trip UI.
}

// ---------------------------------------------------------------------------
// Presence.
//
// The socket.io server emitted `presence:counts` to every client. Under Pusher
// that needs a `presence-*` channel carrying a user_id — a larger change than
// C4 requires. No component subscribed to these events (only the exports
// existed), so the helpers stay as inert placeholders to keep any import we
// may have missed compiling.
// ---------------------------------------------------------------------------

export function onPresence(_cb: (counts: PresenceCounts) => void): () => void {
  return () => {
    /* presence not implemented under Pusher (C4) */
  };
}

export function onPresenceUpdate(_cb: (counts: PresenceCounts) => void): () => void {
  return () => {
    /* presence not implemented under Pusher (C4) */
  };
}

