'use client';

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type ActionPerformed,
  type RegistrationError,
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAppStore, useNavStore } from '@/lib/store';

// One-time flag (per page load) so we don't re-prompt on every navigation
// in the same session. Persisting the "asked" state to localStorage is
// intentionally avoided — if the user denied once they can change their
// mind in the system settings, and we'd rather not nag them on next launch.
let initialized = false;
let permissionRequested = false;
let channelCreated = false;

// *** MUST stay in sync with the server payload ***
// src/lib/firebase-admin.ts -> ANDROID_CHANNEL_ID. If these disagree, the
// FCM message names a channel Android cannot find and the notification is
// silently *dropped from the system tray* (it still reaches the JS layer,
// which is exactly the "shows in the notification center but not the top
// bar" symptom).
export const ORDERS_CHANNEL_ID = 'wassilha_orders';
export const ORDERS_CHANNEL_NAME = 'طلبات وصّلها';
export const ORDERS_CHANNEL_DESC = 'إشعارات الطلبات والعروض الجديدة';
// Brand teal, identical to --primary / --brand in globals.css.
export const NOTIFICATION_COLOR = '#0E6B5E';
// Resource name in android/app/src/main/res (without the extension / density
// suffix). `ic_launcher` exists as a real PNG in every mipmap bucket plus an
// adaptive XML in mipmap-anydpi-v26, so it resolves on every API level.
export const NOTIFICATION_ICON = 'ic_launcher';

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
 * Android 8+ (API 26+) will NOT display a notification that targets a channel
 * id which does not exist — the whole tray notification is dropped, even
 * though the push is delivered to the JS layer. Our backend always targets
 * `ORDERS_CHANNEL_ID`, so this must run before the first push can arrive.
 *
 * Creating a channel that already exists is a documented no-op that keeps
 * the user's custom settings (importance / sound / vibration), so it is safe
 * to call on every cold start. On iOS / web `createChannel` is a no-op stub,
 * and on pre-26 Android channels are simply ignored by the OS.
 */
async function ensureNotificationChannel(): Promise<void> {
  if (channelCreated) return;
  channelCreated = true; // set first so we never retry on a failing call
  try {
    await PushNotifications.createChannel({
      id: ORDERS_CHANNEL_ID,
      name: ORDERS_CHANNEL_NAME,
      description: ORDERS_CHANNEL_DESC,
      // 5 == IMPORTANCE_MAX (heads-up banner + sound + vibration), which is
      // the right level for "you have a new order / your offer was accepted".
      importance: 5,
      // 1 == VISIBILITY_PRIVATE (redact on lockscreen, show on normal use).
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
      lightColor: NOTIFICATION_COLOR,
    });

    // The foreground re-post below goes through the Local Notifications
    // plugin, which has its own channel table — create the same id there so
    // the banner behaviour matches the FCM background path. (smallIcon /
    // iconColor are set globally via the LocalNotifications plugin config in
    // capacitor.config.ts, not per-channel.)
    await LocalNotifications.createChannel({
      id: ORDERS_CHANNEL_ID,
      name: ORDERS_CHANNEL_NAME,
      description: ORDERS_CHANNEL_DESC,
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
      lightColor: NOTIFICATION_COLOR,
    });
  } catch (e) {
    // Not fatal: on iOS/web these calls resolve as no-ops and on old Android
    // they are ignored. A failure here must not block registration.
    // eslint-disable-next-line no-console
    console.warn('[push-notifications] failed to create channel:', e);
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

    // Channel must exist *before* the first FCM message can land, otherwise
    // the OS drops the tray notification. Run it right after permission is
    // granted and before the token registration handshake.
    await ensureNotificationChannel();

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

  // Fire and forget: creates the Android channel up-front so a push that
  // arrives before the user has signed in (or while /api/auth/me is still in
  // flight) can still be shown in the system tray.
  void ensureNotificationChannel();

  PushNotifications.addListener('registration', (token) => {
    void postTokenToServer(token.value, Capacitor.getPlatform());
  });

  PushNotifications.addListener('registrationError', (err: RegistrationError) => {
    // eslint-disable-next-line no-console
    console.warn('[push-notifications] registration error:', err.error);
  });

  // Foreground push: a notification arrived while the app is open. On Android
  // the FCM service does NOT raise a system notification while the app is in
  // the foreground, so we re-post it as a local notification to guarantee it
  // still lands in the top notification bar — same UX as when the app is
  // closed. The FCM `data` block (type/orderId/...) is forwarded via `extra`
  // so a tap on this re-posted notification deep-links exactly like a
  // background one. Wrapped in try/catch: a display failure must never break
  // the token registration or the OTP flows.
  PushNotifications.addListener(
    'pushNotificationReceived',
    async (notification: PushNotificationSchema) => {
      // eslint-disable-next-line no-console
      console.log('[push-notifications] received in foreground:', notification);
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Date.now(),
              title: notification.title || 'وصّلها',
              body: notification.body || '',
              smallIcon: NOTIFICATION_ICON,
              // Same channel as the background FCM path: identical banner /
              // sound / vibration rules, and the channel's importance decides
              // whether it shows as a heads-up in the top bar.
              channelId: ORDERS_CHANNEL_ID,
              // Capacitor's `extra` survives to the tap action on both
              // platforms; the FCM data block is copied verbatim.
              extra: notification.data ?? {},
            },
          ],
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[push-notifications] failed to post local notification:', e);
      }
    }
  );

  // User tapped a notification (background or foreground). The FCM data
  // block carries the deep-link target, so we switch the active tab and pin
  // the orderId in the nav store. Both customer-track and driver-requests
  // read `activeOrderId`, so the relevant screen opens directly on the
  // order instead of dropping the user on the default tab.
  PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: ActionPerformed) => {
      // eslint-disable-next-line no-console
      console.log('[push-notifications] action performed:', action);
      try {
        // Background taps deliver `data` on `notification`; the foreground
        // re-post above mirrors it into `extra` (not part of the schema's
        // type, but Capacitor passes it through to the action payload).
        const data = (action.notification.data ??
          (action.notification as ActionPerformed['notification'] & {
            extra?: Record<string, unknown>;
          }).extra ??
          {}) as Record<string, unknown>;
        const orderId =
          typeof data.orderId === 'string' ? data.orderId : null;
        const type = typeof data.type === 'string' ? data.type : null;

        const role = useAppStore.getState().user?.role;

        if (orderId) {
          useNavStore.getState().setActiveOrderId(orderId);
        }

        // Route by audience. Driver-targeted events (new request, offer
        // outcome, customer counter) land on the requests list; everything
        // else is customer-facing and lands on tracking.
        const driverTypes = new Set([
          'order_new_request',
          'offer_accepted',
          'offer_rejected',
          'offer_countered',
        ]);
        if (role === 'driver' || (type && driverTypes.has(type))) {
          useNavStore.getState().setDriverTab('requests');
        } else {
          useNavStore.getState().setCustomerTab('track');
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[push-notifications] failed to route from tap:', e);
      }
    }
  );
}
