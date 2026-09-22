// C4 — Pusher client singleton (browser side).
//
// Frontend components import the helpers from `@/lib/realtime` (which wrap
// this client) rather than subscribing directly, so channel naming and event
// binding stay in one place. See `realtime.ts` for the public API.
//
// Client-safe: only NEXT_PUBLIC_* vars are read, so the app secret never
// reaches the browser. The subscription signature is produced server-side by
// POST /api/pusher/auth, which re-checks the session on every join.

'use client';

import Pusher from 'pusher-js';

let client: Pusher | null = null;

export function pusherClient(): Pusher {
  if (client) return client;

  client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY as string, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER as string,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: '/api/pusher/auth',
      // The session cookie travels automatically (same-origin), so no headers
      // are needed here. CSRF is a non-issue: the only effect of a forged
      // auth request would be signing a channel the attacker could already
      // open with their own session.
    },
    // Pusher is a hard realtime dependency, but the app must still work while
    // it's unreachable (offline-first mobile). Keep the default retries and
    // let the polling fallbacks in driver-requests/driver-trips carry state.
  });

  return client;
}

// Channel names must match the server exactly (`pusher-server.ts`).
export function orderChannel(orderId: string): string {
  return `private-order-${orderId}`;
}

export function driverChannel(userId: string): string {
  return `private-driver-${userId}`;
}

export const ADMIN_CHANNEL = 'private-admin';

// Pusher's own type for the callbacks registered on a channel — avoids
// `any` in realtime.ts.
export type PusherEventHandler = (data: unknown) => void;
