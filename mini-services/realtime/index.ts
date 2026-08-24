// WASSILHA Realtime mini-service
// Standalone socket.io server on port 3003, path "/" (required by Caddy gateway).
// Pure realtime relay — the Next.js API routes own the DB. This service only
// fans out order + driver-location events to interested clients.

import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const PORT = 3003

const httpServer = createServer()

const io = new Server(httpServer, {
  // Caddy forwards `/?XTransformPort=3003` to this service — path MUST be '/'.
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type Role = 'customer' | 'driver' | 'admin'

interface SocketMeta {
  userId: string
  role: Role
}

interface OrderShape {
  id: string
  customerId: string
  driverId?: string | null
  status?: string
  [k: string]: unknown
}

interface StartTrackPayload {
  orderId: string
  driverId: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

// ----------------------------------------------------------------------------
// In-memory state (no DB)
// ----------------------------------------------------------------------------

const socketMeta = new Map<string, SocketMeta>() // socket.id -> {userId, role}

// Active simulated movement loops: orderId -> NodeJS.Timeout
const trackTimers = new Map<string, NodeJS.Timeout>()

// Map orderId -> socket.id of the driver currently simulating movement,
// so we can stop the timer on disconnect.
const trackOwners = new Map<string, string>()

// Map driverId -> Set<orderId> being tracked by that driver's sockets,
// used during disconnect cleanup.
const driverTracks = new Map<string, Set<string>>()

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function roleRoom(role: Role) {
  return `role:${role}`
}

function userRoom(userId: string) {
  return `user:${userId}`
}

function presenceCounts() {
  const counts = { customer: 0, driver: 0, admin: 0, total: 0 }
  for (const meta of socketMeta.values()) {
    counts[meta.role] += 1
    counts.total += 1
  }
  return counts
}

function broadcastPresence() {
  const counts = presenceCounts()
  io.to(roleRoom('admin')).emit('presence:update', counts)
  // Also let everyone know (lightweight) so admin dashboards stay in sync.
  io.emit('presence:counts', counts)
}

function stopTrack(orderId: string) {
  const timer = trackTimers.get(orderId)
  if (timer) {
    clearInterval(timer)
    trackTimers.delete(orderId)
  }
  const driverId = trackOwners.get(orderId)
  trackOwners.delete(orderId)
  if (driverId) {
    const set = driverTracks.get(driverId)
    if (set) {
      set.delete(orderId)
      if (set.size === 0) driverTracks.delete(driverId)
    }
  }
}

// ----------------------------------------------------------------------------
// Connection handling
// ----------------------------------------------------------------------------

io.on('connection', (socket: Socket) => {
  console.log(`[realtime] connected: ${socket.id}`)

  // ---- presence / join ----------------------------------------------------
  socket.on('client:join', (payload: { userId: string; role: Role }) => {
    if (!payload || !payload.userId || !payload.role) {
      socket.emit('error:message', { message: 'client:join requires {userId, role}' })
      return
    }
    const { userId, role } = payload
    socketMeta.set(socket.id, { userId, role })
    socket.join(roleRoom(role))
    socket.join(userRoom(userId))
    socket.emit('server:joined', { userId, role })
    broadcastPresence()
    console.log(`[realtime] join ${userId} as ${role} (socket ${socket.id})`)
  })

  // ---- order dispatch -----------------------------------------------------
  // Broadcast a freshly created order to all online drivers.
  socket.on('order:created', (payload: { order: OrderShape }) => {
    if (!payload?.order) return
    const { order } = payload
    io.to(roleRoom('driver')).emit('order:new-request', { order })
    io.to(roleRoom('admin')).emit('order:update', { order })
    console.log(`[realtime] order:created ${order.code ?? order.id} -> drivers`)
  })

  // Driver accepted an order → tell the customer + admin.
  socket.on('order:accepted', (payload: { order: OrderShape }) => {
    if (!payload?.order) return
    const { order } = payload
    io.to(userRoom(order.customerId)).emit('order:status', { order })
    io.to(roleRoom('admin')).emit('order:update', { order })
    if (order.driverId) io.to(userRoom(order.driverId)).emit('order:status', { order })
    console.log(`[realtime] order:accepted ${order.id} -> customer ${order.customerId}`)
  })

  // Generic status transition (picked / delivered / cancelled / searching).
  socket.on('order:status', (payload: { order: OrderShape }) => {
    if (!payload?.order) return
    const { order } = payload
    io.to(userRoom(order.customerId)).emit('order:status', { order })
    io.to(roleRoom('admin')).emit('order:update', { order })
    if (order.driverId) io.to(userRoom(order.driverId)).emit('order:status', { order })
    console.log(`[realtime] order:status ${order.status ?? '?'} for ${order.id}`)
  })

  // ---- driver location broadcast -----------------------------------------
  // Single-shot location ping (e.g. real GPS — not used in sandbox but supported).
  socket.on('driver:location', (payload: {
    orderId: string
    lat: number
    lng: number
    driverId: string
  }) => {
    if (!payload?.orderId) return
    // Look up the customer for this order through the tracking owner map is not
    // possible here (we don't have the customerId). The caller (frontend/API)
    // emits this from a context where it knows the customer; but since this is
    // a relay, we broadcast to all customers that joined a per-order room.
    // For simplicity we also emit into an order-specific room.
    io.to(`order:${payload.orderId}`).emit('driver:location', payload)
    io.to(roleRoom('admin')).emit('driver:location', payload)
  })

  // ---- simulated movement (sandbox GPS replacement) ----------------------
  socket.on('driver:start-track', (payload: StartTrackPayload) => {
    if (!payload?.orderId || !payload?.driverId) return
    const { orderId, driverId, startLat, startLng, endLat, endLng } = payload

    // Stop any previous track for this order.
    stopTrack(orderId)

    const meta = socketMeta.get(socket.id)
    if (!meta) {
      socket.emit('error:message', { message: 'join before driver:start-track' })
      return
    }

    // Make sure the customer room (user:<customerId>) is the target.
    // We don't know the customer here, so we use the per-order room. The
    // frontend customer joins `order:<orderId>` when tracking.
    socket.join(`order:${orderId}`)

    trackOwners.set(orderId, socket.id)
    if (!driverTracks.has(driverId)) driverTracks.set(driverId, new Set())
    driverTracks.get(driverId)!.add(orderId)

    const DURATION_MS = 20_000
    const STEP_MS = 1_500
    const totalSteps = Math.max(1, Math.round(DURATION_MS / STEP_MS))
    let step = 0

    console.log(`[realtime] start-track order ${orderId} driver ${driverId} (${totalSteps} steps)`)

    const timer = setInterval(() => {
      step += 1
      const t = Math.min(1, step / totalSteps)
      // Linear interpolation (good enough for a demo).
      const lat = startLat + (endLat - startLat) * t
      const lng = startLng + (endLng - startLng) * t
      const locationPayload = { orderId, lat, lng, driverId }
      io.to(`order:${orderId}`).emit('driver:location', locationPayload)
      io.to(roleRoom('admin')).emit('driver:location', locationPayload)

      if (step >= totalSteps) {
        console.log(`[realtime] track complete order ${orderId}`)
        stopTrack(orderId)
      }
    }, STEP_MS)

    trackTimers.set(orderId, timer)
  })

  socket.on('driver:stop-track', (payload: { orderId: string }) => {
    if (!payload?.orderId) return
    console.log(`[realtime] stop-track order ${payload.orderId}`)
    stopTrack(payload.orderId)
  })

  // Allow customers to subscribe to a specific order's location stream.
  socket.on('order:subscribe', (payload: { orderId: string }) => {
    if (!payload?.orderId) return
    socket.join(`order:${payload.orderId}`)
    console.log(`[realtime] socket ${socket.id} subscribed to order ${payload.orderId}`)
  })

  socket.on('order:unsubscribe', (payload: { orderId: string }) => {
    if (!payload?.orderId) return
    socket.leave(`order:${payload.orderId}`)
  })

  // ---- error & disconnect ------------------------------------------------
  socket.on('error', (err: unknown) => {
    console.error(`[realtime] socket error ${socket.id}:`, err)
  })

  socket.on('disconnect', (reason: string) => {
    const meta = socketMeta.get(socket.id)
    console.log(`[realtime] disconnected: ${socket.id} (${reason})`)

    if (meta) {
      // Clean up any active tracks owned by this driver.
      const tracks = driverTracks.get(meta.userId)
      if (tracks) {
        for (const orderId of tracks) {
          stopTrack(orderId)
        }
      }
    }
    socketMeta.delete(socket.id)
    broadcastPresence()
  })
})

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`[wassilha-realtime] listening on :${PORT} (path "/")`)
})

// ----------------------------------------------------------------------------
// Graceful shutdown
// ----------------------------------------------------------------------------

function shutdown(signal: string) {
  console.log(`[wassilha-realtime] ${signal} received, shutting down...`)
  for (const timer of trackTimers.values()) clearInterval(timer)
  trackTimers.clear()
  trackOwners.clear()
  driverTracks.clear()
  io.close(() => {
    httpServer.close(() => {
      console.log('[wassilha-realtime] closed')
      process.exit(0)
    })
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
