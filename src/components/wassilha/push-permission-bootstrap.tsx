'use client';

import { useEffect } from 'react';
import { initPushNotificationListeners, requestPushPermissionAndRegister } from '@/lib/push-notifications';

/**
 * Mounted once in the root layout. Its only job is to:
 *   1. wire up the global FCM listeners (idempotent), and
 *   2. request permission + register the device the first time the user
 *      becomes authenticated (i.e. after /api/auth/me returns a real user).
 *
 * Calling this from the layout (rather than from the post-login screen)
 * means the prompt survives a hard refresh on a deep link, and that the
 * very first foreground push after install is correctly attributed.
 */
export function PushPermissionBootstrap() {
  useEffect(() => {
    initPushNotificationListeners();

    let cancelled = false;
    const tryRegister = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: unknown };
        if (cancelled) return;
        if (!data || !data.user) return;
        // User is signed in. Ask the OS for permission; if granted, the
        // 'registration' listener (wired in initPushNotificationListeners)
        // will POST the token to /api/notifications/register.
        void requestPushPermissionAndRegister();
      } catch {
        // ignore — bootstrap is best-effort
      }
    };

    // Defer slightly so the first paint of the app is not blocked on the
    // permission prompt. The native dialog is still synchronous to the JS
    // thread, but a tiny delay keeps the splash → main transition smooth.
    const timer = window.setTimeout(tryRegister, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
