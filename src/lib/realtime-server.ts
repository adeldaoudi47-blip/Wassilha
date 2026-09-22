// ---------------------------------------------------------------------------
// WASSILHA realtime — server relay helpers (C4 - Pusher).
//
// HISTORY: this file used to run an in-process socket.io server on port 3003.
// That works when Next.js runs as one long-lived process (the sandbox /
// `next start`), but it cannot survive the Vercel serverless deploy: a
// function instance is frozen between invocations and the extra HTTP listener
// dies, so live tracking would silently stop in production.
//
// The public exports this module was imported for (`ensureRealtime`,
// `broadcastDriverLocation`) are preserved below, now backed by Pusher via
// `pusher-server.ts`. Two call sites relied on them:
//
//   GET  /api/auth/me          -> ensureRealtime()           (boot hint, now a no-op)
//   POST /api/driver/location  -> broadcastDriverLocation()  (driver GPS fan-out)
//
// Keeping the names means those routes did not have to change to keep working.
// Nothing else imports this module; the socket.io server class itself is gone.
// ---------------------------------------------------------------------------

export { ensureRealtime, broadcastDriverLocation } from './pusher-compat';
