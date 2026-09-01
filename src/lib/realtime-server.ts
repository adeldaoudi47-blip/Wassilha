// In-process socket.io server for WASSILHA realtime.
//
// The sandbox environment kills standalone background processes when a bash
// command completes, so a separate mini-service can't stay alive. Instead, we
// start the socket.io server inside the Next.js process (which IS persistent).
// This module is imported as a side-effect from an API route, so the server
// starts on the first API call and lives as long as the dev server does.

import type { Server as IOServer, Socket } from 'socket.io';
import type { Order } from './types';
import { getSession, SESSION_COOKIE } from './auth';

const REALTIME_PORT = 3003;

interface DriverTrack {
  // Legacy type kept only for the global handle shape — real GPS tracking
  // no longer runs on the server. Drivers now POST their position to
  // /api/driver/location which fans it out to subscribers.
  orderId: string;
  driverId: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  interval: ReturnType<typeof setInterval>;
  progress: number;
}

const globalForRealtime = globalThis as unknown as {
  __wassilhaIo?: IOServer | null;
  __wassilhaTracks?: Map<string, DriverTrack>;
  __wassilhaSockets?: Map<string, { userId: string; role: string }>;
};

function startRealtime(): IOServer | null {
  if (globalForRealtime.__wassilhaIo) {
    return globalForRealtime.__wassilhaIo;
  }

  // Dynamically import so this doesn't break if socket.io isn't installed
  let createServer: typeof import('http').createServer;
  let Server: typeof import('socket.io').Server;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sio = require('socket.io');
    createServer = http.createServer;
    Server = sio.Server;
  } catch {
    console.warn('[wassilha-realtime] socket.io not available, realtime disabled');
    return null;
  }

  const tracks = new Map<string, DriverTrack>();
  const sockets = new Map<string, { userId: string; role: string }>();
  globalForRealtime.__wassilhaTracks = tracks;
  globalForRealtime.__wassilhaSockets = sockets;
  // The `tracks` map is intentionally kept around even though no events
  // populate it anymore. It exists so that future server-side driver
  // analytics (e.g. geofencing) have a place to register per-trip state
  // without needing a schema migration.

  const httpServer = createServer((req, res) => {
    // Health check
    if (req.url && req.url.includes('health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connections: sockets.size }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  // SECURITY: explicit CORS allowlist. Read from CORS_ALLOWED_ORIGINS env
  // (comma-separated). Falls back to localhost dev origins. Never use '*'
  // because we need `credentials: true` for the wassilha_session cookie.
  const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS
    ?? 'http://localhost:3000,http://localhost:3003'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const io = new Server(httpServer, {
    path: '/',
    cors: {
      origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
        // Same-origin / curl / server-to-server: no Origin header.
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        console.warn(`[wassilha-realtime] CORS reject: ${origin}`);
        return cb(new Error('CORS not allowed'), false);
      },
      methods: ['GET', 'POST'],
      credentials: true, // required for the wassilha_session cookie
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const presence = () => {
    const counts = { customer: 0, driver: 0, admin: 0, total: sockets.size };
    for (const s of sockets.values()) {
      counts[s.role as keyof typeof counts] = (counts[s.role as keyof typeof counts] || 0) + 1;
    }
    io.emit('presence:counts', counts);
    io.to('role:admin').emit('presence:update', counts);
  };

  io.on('connection', async (socket: Socket) => {
    // SECURITY: validate the session cookie from the upgrade handshake.
    // Without this, any client could emit `client:join` with any userId
    // and subscribe to admin / driver rooms. We authenticate ONCE at
    // connect-time, then auto-join the verified user/role rooms. The
    // legacy `client:join` event is kept for backwards-compat but is
    // now rejected unless it matches the verified identity.
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    const session = await getSession(cookieHeader).catch(() => null);

    if (!session) {
      console.warn(`[wassilha-realtime] rejected ${socket.id}: invalid session`);
      socket.emit('server:error', { error: 'unauthorized' });
      socket.disconnect(true);
      return;
    }

    // Bind the verified identity to the socket immediately.
    sockets.set(socket.id, { userId: session.id, role: session.role });
    socket.data.userId = session.id;
    socket.data.role = session.role;
    socket.join(`user:${session.id}`);
    socket.join(`role:${session.role}`);

    console.log(`[wassilha-realtime] connected: ${socket.id} (user=${session.id} role=${session.role})`);

    socket.on('client:join', (payload: { userId?: unknown; role?: unknown } | undefined) => {
      // Defense in depth: any client-supplied userId/role MUST match
      // the session-bound identity. This blocks header/cookie spoofing
      // attempts even if the verifier above is bypassed in the future.
      const claimedUserId = typeof payload?.userId === 'string' ? payload.userId : null;
      const claimedRole = typeof payload?.role === 'string' ? payload.role : null;
      if (claimedUserId !== session.id || claimedRole !== session.role) {
        console.warn(`[wassilha-realtime] client:join mismatch on ${socket.id}: claimed=${claimedUserId}/${claimedRole} actual=${session.id}/${session.role}`);
        socket.disconnect(true);
        return;
      }
      socket.emit('server:joined', { userId: session.id, role: session.role });
      presence();
    });

    // Order dispatch
    socket.on('order:created', ({ order }: { order: Order }) => {
      io.to('role:driver').emit('order:new-request', { order });
    });

    socket.on('order:accepted', ({ order }: { order: Order }) => {
      io.to(`user:${order.customerId}`).emit('order:status', { order });
      io.to('role:admin').emit('order:update', { order });
    });

    socket.on('order:status', ({ order }: { order: Order }) => {
      io.to(`user:${order.customerId}`).emit('order:status', { order });
      if (order.driverId) io.to(`user:${order.driverId}`).emit('order:status', { order });
      io.to('role:admin').emit('order:update', { order });
    });

    // Driver location
    socket.on('driver:location', (p: { orderId: string; lat: number; lng: number; driverId: string }) => {
      io.to(`order:${p.orderId}`).emit('driver:location', p);
    });

    socket.on('order:subscribe', ({ orderId }: { orderId: string }) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('order:unsubscribe', ({ orderId }: { orderId: string }) => {
      socket.leave(`order:${orderId}`);
    });

    // driver:start-track / driver:stop-track are no-ops now.
    //
    // The driver used to ask the server to *simulate* a trip by interpolating
    // a straight line between pickup and dropoff. That was useful while the
    // mobile geolocation pipeline wasn't wired up, but it's misleading now:
    // real GPS positions arrive via the HTTP POST /api/driver/location
    // endpoint and are broadcast by broadcastDriverLocation(). We keep the
    // event handlers so any stale client still emitting start-track doesn't
    // crash the server — we just ignore the payload.

    socket.on('driver:start-track', () => {
      // Intentionally empty: real GPS drives the live marker.
    });

    socket.on('driver:stop-track', () => {
      // Intentionally empty: location stops being broadcast once the driver
      // closes the active trip UI (HTTP polling picks up the order status
      // change from the DB and stops the geolocation watcher client-side).
    });

    socket.on('disconnect', () => {
      sockets.delete(socket.id);
      presence();
      console.log(`[wassilha-realtime] disconnected: ${socket.id}`);
    });
  });

  httpServer.listen(REALTIME_PORT, () => {
    console.log(`[wassilha-realtime] listening on :${REALTIME_PORT} (in-process, path "/")`);
  });

  // Handle EADDRINUSE gracefully (another instance might be starting)
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[wassilha-realtime] port ${REALTIME_PORT} in use, assuming another instance`);
    } else {
      console.error('[wassilha-realtime] error:', err);
    }
  });

  globalForRealtime.__wassilhaIo = io;
  return io;
}

// Ensure the server is started. Safe to call multiple times (idempotent).
export function ensureRealtime(): void {
  try {
    startRealtime();
  } catch (e) {
    console.warn('[wassilha-realtime] failed to start:', e);
  }
}

// Broadcast a driver location update to every client subscribed to the
// given order room. Used by /api/driver/location (HTTP) when the driver
// posts a fix from a mobile app that may not have a stable socket.io
// connection (e.g. backgrounded browser, weak network).
//
// Falls through silently if the realtime server hasn't booted yet.
export function broadcastDriverLocation(
  orderId: string,
  lat: number,
  lng: number,
  driverId: string,
): void {
  const io = globalForRealtime.__wassilhaIo;
  if (!io) {
    ensureRealtime();
    return;
  }
  io.to(`order:${orderId}`).emit('driver:location', {
    orderId,
    lat,
    lng,
    driverId,
  });
}
