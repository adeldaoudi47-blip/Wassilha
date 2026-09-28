'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  connectSocket,
  disconnectSocket,
  onRealtimeStateChange,
  type RealtimeStatus,
} from '@/lib/realtime';

// Connects the socket when a user is logged in, disconnects on logout.
//
// PHASE 6 (Part 14 - reconnect recovery): realtime delivery is at-most-best-
// effort. A backgrounded mobile tab, a sleeping laptop lid or a dropped network
// all mean events were MISSED, and Pusher does not replay them. So whenever the
// connection returns to `connected` after having been away, we bump a counter
// that screens watch to refetch their authoritative state. That refetch — not
// the event stream — is what guarantees the screen converges.
//
// Part 15 (multi-tab): this refetch is a plain GET, so a second tab recovering
// on its own can never perform a duplicate database WRITE.
export function useRealtime() {
  const user = useAppStore((s) => s.user);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  // Increments on every reconnect so dependents can refetch.
  const [reconnectTick, setReconnectTick] = useState(0);

  useEffect(() => {
    if (user) {
      connectSocket(user.id, user.role);
    } else {
      disconnectSocket();
    }
    return () => {
      // keep socket alive across re-renders; only disconnect on logout (handled above)
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user) return;
    let wasDown = false;
    const off = onRealtimeStateChange((next) => {
      setStatus(next);
      if (next === 'connected') {
        // Only refetch if we actually lost the connection — not on the very
        // first connect, where the screen is already fetching its initial data.
        if (wasDown) setReconnectTick((n) => n + 1);
        wasDown = false;
      } else if (next === 'offline' || next === 'unavailable') {
        wasDown = true;
      }
    });
    return off;
  }, [user?.id]);

  // Derived rather than set from inside the effect: a signed-out session has no
  // socket at all, so "offline" is a pure function of `user` and needs no
  // setState in an effect body.
  return { status: user ? status : 'offline', reconnectTick };
}
