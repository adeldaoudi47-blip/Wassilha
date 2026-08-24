// In-process socket.io server for WASSILHA realtime.
//
// The sandbox environment kills standalone background processes when a bash
// command completes, so a separate mini-service can't stay alive. Instead, we
// start the socket.io server inside the Next.js process (which IS persistent).
// This module is imported as a side-effect from an API route, so the server
// starts on the first API call and lives as long as the dev server does.

import type { Server as IOServer, Socket } from 'socket.io';
import type { Order } from './types';

const REALTIME_PORT = 3003;

interface DriverTrack {
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

  const io = new Server(httpServer, {
    path: '/',
    cors: { origin: '*', methods: ['GET', 'POST'] },
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

  io.on('connection', (socket: Socket) => {
    console.log(`[wassilha-realtime] connected: ${socket.id}`);

    socket.on('client:join', ({ userId, role }: { userId: string; role: string }) => {
      sockets.set(socket.id, { userId, role });
      socket.join(`role:${role}`);
      socket.join(`user:${userId}`);
      socket.emit('server:joined', { userId, role });
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

    // Simulated movement
    socket.on('driver:start-track', (p: { orderId: string; driverId: string; startLat: number; startLng: number; endLat: number; endLng: number }) => {
      // stop existing
      const ex = tracks.get(p.orderId);
      if (ex) clearInterval(ex.interval);
      const track: DriverTrack = { ...p, progress: 0, interval: setInterval(() => {}) };
      track.interval = setInterval(() => {
        track.progress += 0.08;
        const lat = p.startLat + (p.endLat - p.startLat) * track.progress;
        const lng = p.startLng + (p.endLng - p.startLng) * track.progress;
        io.to(`order:${p.orderId}`).emit('driver:location', {
          orderId: p.orderId, lat, lng, driverId: p.driverId,
        });
        if (track.progress >= 1) {
          clearInterval(track.interval);
          tracks.delete(p.orderId);
        }
      }, 1500);
      tracks.set(p.orderId, track);
    });

    socket.on('driver:stop-track', ({ orderId }: { orderId: string }) => {
      const t = tracks.get(orderId);
      if (t) {
        clearInterval(t.interval);
        tracks.delete(orderId);
      }
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
