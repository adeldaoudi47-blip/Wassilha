'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { connectSocket, disconnectSocket } from '@/lib/realtime';

// Connects the socket when a user is logged in, disconnects on logout.
export function useRealtime() {
  const user = useAppStore((s) => s.user);
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
}
