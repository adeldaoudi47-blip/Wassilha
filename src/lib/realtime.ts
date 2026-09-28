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
  userChannel,
  ADMIN_CHANNEL,
  type PusherEventHandler,
} from './pusher-client';
import type { Order, RealtimeNotificationEvent, RealtimeOfferEvent, Role } from './types';

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
//
// PHASE 6: EVERY role now joins `private-user-<id>` here, because that is where
// `notification:new` is delivered. Doing it once at login (instead of per
// component) keeps the app on a single logical connection with a single auth
// round-trip (Part 21), and guarantees the bell and the toast layer can never
// race each other onto the channel.
export function connectSocket(userId: string, role: Role) {
  currentUserId = userId;
  currentRole = role;
  const c = pusherClient();
  client = c;
  c.subscribe(userChannel(userId));
  if (role === 'driver') c.subscribe(driverChannel(userId));
  if (role === 'admin') c.subscribe(ADMIN_CHANNEL);
  return c;
}

export function disconnectSocket(): void {
  const existing = client ?? pusherClient();
  if (existing) {
    // `client` is set by connectSocket, so this now actually tears the socket
    // down on logout. Before Phase 6 it read a variable nothing ever assigned,
    // so the previous session's private channels stayed joined and a logged-out
    // tab could still have been receiving events.
    existing.disconnect();
    existing.unsubscribe(ADMIN_CHANNEL);
  }
  currentUserId = null;
  currentRole = null;
  // A fresh connectSocket must re-subscribe, so drop the memoised handle.
  client = null;
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

// PHASE 6: the old `onOrderUpdate` (which bound the RETIRED `order:update`
// event) is gone. That event had zero emitters, so the listener could never
// fire; the admin console now subscribes to the real `order:status` fan-out
// through `onAdminOrderStatus` below.

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
// PHASE 6 - negotiation + notification subscriptions.
//
// All three bind through `bindOnShared`, which unbinds the handler but LEAVES the
// channel joined. `bindOn` unsubscribes the channel on cleanup, which is correct
// for a one-consumer per-order channel but wrong for `private-user-<id>`: the
// bell and the toast listener both sit on it, so tearing it down when the first
// of them unmounts would silently kill the other's live feed. Keeping the single
// connection (Part 21) also means one auth round-trip for the whole session.
// ---------------------------------------------------------------------------

function bindOnShared(
  channelName: string,
  event: string,
  cb: (data: unknown) => void,
): () => void {
  const channel = pusherClient().subscribe(channelName);
  const handler: PusherEventHandler = (data: unknown) => cb(data);
  channel.bind(event, handler);
  return () => {
    // Unbind only - the channel stays joined for the other consumers.
    channel.unbind(event, handler);
  };
}

/**
 * A new bid landed on `orderId` (or an existing one changed state while this
 * order channel is the audience). Customer-facing: the customer owns the order
 * channel, so this can only ever deliver that order's own negotiation.
 */
export function onOfferEvent(
  orderId: string,
  cb: (event: RealtimeOfferEvent) => void,
): () => void {
  return bindOnShared(orderChannel(orderId), 'offer:new', (data) =>
    cb(data as RealtimeOfferEvent),
  );
}

/**
 * The result of MY offer - countered, accepted or rejected. Driver-facing: the
 * driver owns `private-driver-<id>`, so this only ever carries bids this driver
 * placed, and the server never puts another driver's negotiation on the channel.
 */
export function onMyOfferUpdate(
  driverId: string,
  cb: (event: RealtimeOfferEvent) => void,
): () => void {
  return bindOnShared(driverChannel(driverId), 'offer:update', (data) =>
    cb(data as RealtimeOfferEvent),
  );
}

/**
 * A notification row was committed for this user. Used by the bell (live badge
 * + list) and the toast layer, both of which read the SAME `private-user-<id>`
 * channel.
 */
export function onNotificationNew(
  userId: string,
  cb: (event: RealtimeNotificationEvent) => void,
): () => void {
  return bindOnShared(userChannel(userId), 'notification:new', (data) =>
    cb(data as RealtimeNotificationEvent),
  );
}

/**
 * PHASE 6: the same `order:status` event, on the admin channel. The server
 * fans `order:status` out to `private-admin` alongside the order channel, so
 * the admin console sees every transition without subscribing to N order
 * channels. `private-admin` is admin-only (see /api/pusher/auth), so nothing
 * here widens access beyond what the admin APIs already permit (Part 2).
 */
export function onAdminOrderStatus(
  cb: (order: Order) => void,
): () => void {
  // `bindOnShared`, not `bindOn`: the fleet map also binds to `private-admin`,
  // so unsubscribing the channel when THIS screen unmounts would silently kill
  // the other one's live feed.
  return bindOnShared(ADMIN_CHANNEL, 'order:status', (data) => cb(data as Order));
}

// ---------------------------------------------------------------------------
// Connection state (Part 18 - connecting / connected / reconnecting / offline).
//
// pusher-js owns reconnection and retries; we only SURFACE what it is doing so
// the UI can show an honest chip and so `useRealtime` can refetch authoritative
// state the moment the socket comes back (Part 14 - events missed while asleep
// are not replayed).
//
// Listeners are fanned out from one `state_change` binding: the status chip and
// the refetch hook both care, and a second `connection.bind` would be a second
// listener for the same signal on the same connection (Part 21).
// ---------------------------------------------------------------------------

export type RealtimeStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'unavailable';

const stateListeners = new Set<(status: RealtimeStatus) => void>();
let stateBound = false;

function toStatus(state: string): RealtimeStatus {
  if (state === 'connected') return 'connected';
  if (state === 'connecting' || state === 'initialized') return 'connecting';
  if (state === 'unavailable') return 'unavailable';
  if (state === 'failed' || state === 'disconnected') return 'offline';
  return 'reconnecting';
}

function emitState(state: string): void {
  const status = toStatus(state);
  for (const listener of stateListeners) listener(status);
}

function ensureStateBound(): void {
  if (stateBound) return;
  const connection = pusherClient().connection;
  connection.bind('state_change', (states: { current: string }) => {
    emitState(states.current);
  });
  stateBound = true;
}

/** Current connection state, for a component's first render (no waiting). */
export function getRealtimeStatus(): RealtimeStatus {
  return toStatus(pusherClient().connection.state);
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function onRealtimeStateChange(cb: (status: RealtimeStatus) => void): () => void {
  ensureStateBound();
  stateListeners.add(cb);
  return () => {
    stateListeners.delete(cb);
  };
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

