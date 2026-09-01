// WASSILHA realtime client helper.
//
// Singleton socket.io client that connects through the Caddy gateway to the
// realtime mini-service on port 3003. The path is "/" and the port is encoded
// in the `XTransformPort` query param (per sandbox gateway rules).
//
// Frontend components import the helpers below to emit & listen to events.
// The realtime service is a pure relay — DB state lives in the Next.js API
// routes. After every API call that changes order state, the caller emits the
// matching socket event so other connected clients update in real time.

'use client'

import { io, Socket } from 'socket.io-client'
import type { Order, Role } from './types'

// ---------------------------------------------------------------------------
// Singleton socket
// ---------------------------------------------------------------------------

const SOCKET_URL = '/' // relative — Caddy routes to Next.js by default
const SOCKET_QUERY = { XTransformPort: '3003' }

let socket: Socket | null = null
let currentUserId: string | null = null
let currentRole: Role | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      path: '/',
      query: SOCKET_QUERY,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      autoConnect: true,
      // SECURITY: must be true so the browser sends the `wassilha_session`
      // httpOnly cookie with the upgrade request. Without it, the realtime
      // server cannot identify the user and disconnects the socket.
      withCredentials: true,
    })

    if (typeof window !== 'undefined') {
      socket.on('connect', () => {
        // Re-join after reconnect if we already had a session.
        if (currentUserId && currentRole) {
          socket!.emit('client:join', { userId: currentUserId, role: currentRole })
        }
      })
      socket.on('disconnect', (reason: string) => {
        console.log('[realtime] disconnected:', reason)
      })
      socket.on('connect_error', (err: Error) => {
        console.warn('[realtime] connect_error:', err.message)
      })
    }
  }
  return socket
}

export function connectSocket(userId: string, role: Role): Socket {
  const s = getSocket()
  currentUserId = userId
  currentRole = role
  if (!s.connected) {
    s.connect()
  }
  s.emit('client:join', { userId, role })
  return s
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners?.()
    socket.disconnect()
    socket = null
    currentUserId = null
    currentRole = null
  }
}

// ---------------------------------------------------------------------------
// Typed event emitter helpers
// ---------------------------------------------------------------------------

export function emitOrderCreated(order: Order): void {
  getSocket().emit('order:created', { order })
}

export function emitOrderStatus(order: Order): void {
  // Accepted / picked / delivered / cancelled — all flow through the same
  // generic status channel on the server.
  getSocket().emit('order:status', { order })
}

export function emitOrderAccepted(order: Order): void {
  getSocket().emit('order:accepted', { order })
}

export function emitDriverLocation(
  orderId: string,
  lat: number,
  lng: number,
  driverId: string,
): void {
  getSocket().emit('driver:location', { orderId, lat, lng, driverId })
}

export function startDriverTrack(
  orderId: string,
  driverId: string,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): void {
  getSocket().emit('driver:start-track', {
    orderId,
    driverId,
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng,
  })
}

export function stopDriverTrack(orderId: string): void {
  getSocket().emit('driver:stop-track', { orderId })
}

// ---------------------------------------------------------------------------
// Customer subscription to an order's live location stream
// ---------------------------------------------------------------------------

export function subscribeToOrder(orderId: string): void {
  getSocket().emit('order:subscribe', { orderId })
}

export function unsubscribeFromOrder(orderId: string): void {
  getSocket().emit('order:unsubscribe', { orderId })
}

// ---------------------------------------------------------------------------
// Typed event listener helpers (for components)
// ---------------------------------------------------------------------------

export type PresenceCounts = {
  customer: number
  driver: number
  admin: number
  total: number
}

export function onOrderNewRequest(cb: (order: Order) => void): () => void {
  const s = getSocket()
  const handler = (payload: { order: Order }) => cb(payload.order)
  s.on('order:new-request', handler)
  return () => s.off('order:new-request', handler)
}

export function onOrderStatus(cb: (order: Order) => void): () => void {
  const s = getSocket()
  const handler = (payload: { order: Order }) => cb(payload.order)
  s.on('order:status', handler)
  return () => s.off('order:status', handler)
}

export function onOrderUpdate(cb: (order: Order) => void): () => void {
  // admin-style aggregated update stream
  const s = getSocket()
  const handler = (payload: { order: Order }) => cb(payload.order)
  s.on('order:update', handler)
  return () => s.off('order:update', handler)
}

export function onDriverLocation(
  cb: (p: { orderId: string; lat: number; lng: number; driverId: string }) => void,
): () => void {
  const s = getSocket()
  const handler = (payload: { orderId: string; lat: number; lng: number; driverId: string }) =>
    cb(payload)
  s.on('driver:location', handler)
  return () => s.off('driver:location', handler)
}

export function onPresence(cb: (counts: PresenceCounts) => void): () => void {
  const s = getSocket()
  const handler = (counts: PresenceCounts) => cb(counts)
  s.on('presence:counts', handler)
  return () => s.off('presence:counts', handler)
}

export function onPresenceUpdate(cb: (counts: PresenceCounts) => void): () => void {
  const s = getSocket()
  const handler = (counts: PresenceCounts) => cb(counts)
  s.on('presence:update', handler)
  return () => s.off('presence:update', handler)
}
