'use client';

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type ActionPerformed,
  type RegistrationError,
} from '@capacitor/push-notifications';

// One-time flag (per page load) so we don't re-prompt on every navigation
// in the same session. Persisting the "asked" state to localStorage is
// intentionally avoided — if the user denied once they can change their
// mind in the system settings, and we'd rather not nag them on next launch.
let initialized = false;
let permissionRequested = false;

type RegisterResponse = {
  ok: boolean;
  pushToken?: { id: string; platform: string; updatedAt: string };
  error?: string;
};

async function postTokenToServer(token: string, platform: string): Promise<void> {
  try {
    const res = await fetch('/api/notifications/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) {
      // Non-fatal: the user can still use the app, they just won't receive
      // background push notifications. Log to the console for diagnostics
      // without surfacing a toast to the user.
      // eslint-disable-next-line no-console
      console.warn(
        '[push-notifications] failed to register token:',
        res.status,
        await res.text().catch(() => '')
      );
      return;
    }
    const data = (await res.json()) as RegisterResponse;
    // eslint-disable-next-line no-console
    console.log('[push-notifications] token registered:', data);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push-notifications] register request failed:', e);
  }
}

/**
 * Asks the OS for notification permission and, if granted, fetches the FCM
 * token and POSTs it to /api/notifications/register so the backend can
 * target this device for push notifications.
 *
 * Safe to call from any client component. No-op on the web (the browser's
 * own `Notification.requestPermission` flow is handled by the system push
 * service, not Capacitor). Idempotent within a single page load.
 */
export async function requestPushPermissionAndRegister(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // Only meaningful on a native Capacitor shell (Android/iOS). On the web
  // we still log so it's clear why nothing happens.
  if (!Capacitor.isNativePlatform()) {
    // eslint-disable-next-line no-console
    console.log('[push-notifications] non-native platform, skipping');
    return false;
  }

  if (permissionRequested) return true;
  permissionRequested = true;

  try {
    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      // eslint-disable-next-line no-console
      console.log('[push-notifications] permission not granted:', permStatus.receive);
      return false;
    }

    await PushNotifications.register();
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push-notifications] register flow failed:', e);
    return false;
  }
}

/**
 * Wires up the global listeners that forward FCM events to our backend and
 * (optionally) to the in-app toast surface. Call this exactly once from a
 * top-level client component (we do it from <PushPermissionBootstrap />
 * in the root layout).
 */
export function initPushNotificationListeners(): void {
  if (typeof window === 'undefined') return;
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;
  initialized = true;

  PushNotifications.addListener('registration', (token) => {
    void postTokenToServer(token.value, Capacitor.getPlatform());
  });

  PushNotifications.addListener('registrationError', (err: RegistrationError) => {
    // eslint-disable-next-line no-console
    console.warn('[push-notifications] registration error:', err.error);
  });

  // Foreground push: a notification arrived while the app was open. The
  // native UI already shows it; we just log + expose a hook for future
  // in-app toasts.
  PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: PushNotificationSchema) => {
      // eslint-disable-next-line no-console
      console.log('[push-notifications] received in foreground:', notification);
    }
  );

  // User tapped a notification (background or foreground): navigate / refresh
  // data accordingly. For now we only log — the order details screen is the
  // canonical entry point and is already reachable via the orders list.
  PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: ActionPerformed) => {
      // eslint-disable-next-line no-console
      console.log('[push-notifications] action performed:', action);
    }
  );
}
