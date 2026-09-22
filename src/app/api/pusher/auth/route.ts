import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import Pusher from 'pusher';

// POST /api/pusher/auth — signs a subscription to a private-* channel.
//
// Pusher's private channels require this handshake: the browser asks to join
// `private-order-<id>`, Pusher turns to us with the socket_id + channel_name,
// and we return an HMAC signature only if the caller is allowed in. This is
// the replacement for the socket.io server's `use()` session check.
//
// Authorisation rules:
//   private-admin            — privileged admin only.
//   private-driver-<userId>  — that exact user (drivers subscribe to their own
//                              feed to receive incoming order requests).
//   private-order-<orderId>  — the order's customer or its assigned driver.
//                              An admin can also watch any order.
//
// Everything else is refused. `pusher-js` is configured with
// `channelAuthorization: { transport: 'ajax', endpoint: '/api/pusher/auth' }`
// and carries the session cookie automatically (same-origin), so no token is
// ever exposed to the client.

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // The pusher-js client posts `application/x-www-form-urlencoded`:
  //   socket_id=....&channel_name=private-order-<id>
  const form = await req.formData();
  const socketId = form.get('socket_id');
  const channelName = form.get('channel_name');

  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return NextResponse.json({ error: 'badRequest' }, { status: 400 });
  }

  const allowed = await maySubscribe(session.id, session.role, channelName);
  if (!allowed) {
    // 403 (not 401) — the session is valid, it just isn't allowed here.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ error: 'pusherNotConfigured' }, { status: 503 });
  }

  // Bind to the *server* Pusher instance purely to reuse its signing helper —
  // we never trigger from this route, so appId/cluster are irrelevant here.
  const signer = new Pusher({
    appId: 'auth-only',
    key,
    secret,
    cluster: process.env.PUSHER_CLUSTER || 'mt1',
    useTLS: true,
  });

  const auth = signer.authorizeChannel(socketId, channelName);
  return NextResponse.json(auth);
}

async function maySubscribe(
  userId: string,
  role: string,
  channelName: string,
): Promise<boolean> {
  if (channelName === 'private-admin') {
    return role === 'admin';
  }

  if (channelName.startsWith('private-driver-')) {
    return channelName === `private-driver-${userId}`;
  }

  if (channelName.startsWith('private-order-')) {
    const orderId = channelName.slice('private-order-'.length);
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { customerId: true, driverId: true },
    });
    if (!order) return false;
    if (role === 'admin') return true;
    return order.customerId === userId || order.driverId === userId;
  }

  // Any other private channel name is not part of the app's design.
  return false;
}
