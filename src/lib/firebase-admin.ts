// Server-side Firebase Admin SDK wrapper.
//
// Initializes the Admin SDK exactly once per Node process from environment
// variables. Service-account credentials must NEVER be hard-coded here --
// they belong in Vercel / hosting environment variables:
//
//   FIREBASE_PROJECT_ID         (e.g. "wassilha-18b81")
//   FIREBASE_CLIENT_EMAIL       (e.g. "firebase-adminsdk-...@...iam.gserviceaccount.com")
//   FIREBASE_PRIVATE_KEY        (PEM block; newlines must be passed as \n
//                                and we re-join them below so the value can
//                                be stored as a single-line env var)
//
// If the env vars are missing, all push calls become a silent no-op so
// that local dev / preview builds (where the Admin SDK is not configured)
// keep working without crashing unrelated API routes.

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { db } from '@/lib/db';

type AdminInitResult = {
  app: App | null;
  messaging: Messaging | null;
  reason: 'ok' | 'missing-env' | 'init-failed';
};

let cached: AdminInitResult | null = null;

function readPrivateKey(): string | null {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return null;
  // The PEM often arrives from a hosting provider with literal "\n" escapes;
  // convert them back to real newlines so cert() can parse it.
  return raw.replace(/\\n/g, '\n');
}

function initAdmin(): AdminInitResult {
  if (cached) return cached;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = readPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    cached = { app: null, messaging: null, reason: 'missing-env' };
    return cached;
  }

  // Reuse an existing app when the file is imported from multiple
  // server entrypoints (e.g. in Next dev, route handlers can hot-reload).
  const existing = getApps()[0];
  try {
    const app = existing ?? initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    cached = { app, messaging: getMessaging(app), reason: 'ok' };
    return cached;
  } catch (e) {
    // Initialization can fail if, for example, the private key is malformed.
    // We log the *reason* but never the key itself.
    // eslint-disable-next-line no-console
    console.warn(
      '[firebase-admin] initialization failed; push notifications disabled. reason:',
      e instanceof Error ? e.message : String(e)
    );
    cached = { app: null, messaging: null, reason: 'init-failed' };
    return cached;
  }
}

export function isPushConfigured(): boolean {
  return initAdmin().reason === 'ok';
}

type SendResult = {
  attempted: number;
  successCount: number;
  failureCount: number;
  skipped: boolean;
  reason?: string;
};

// Hard ceiling for any single FCM round-trip. Vercel Pro gives 60s for
// serverless functions but in practice we want every push helper to
// return *well* before that -- a slow FCM should not block the parent
// API route. 5s is generous for sendEachForMulticast on ~500 tokens
// and still fits inside the order-creation critical path.
const FCM_TIMEOUT_MS = 5000;

// Deep-link intent every push carries. The client's tap handler reads this to
// route the user straight to the relevant screen (see
// pushNotificationActionPerformed in src/lib/push-notifications.ts); without
// it a tap just opens the app to the default tab.
const CLICK_ACTION = 'OPEN_ORDER';

// Android notification channel the app creates on first launch (see
// src/lib/push-notifications.ts). Must match EXACTLY — if the channel id
// in the FCM payload does not resolve to an existing channel, Android 8+
// silently drops the notification from the system tray (it is still delivered
// to the JS layer, which is exactly the "center but no top bar" bug).
const ANDROID_CHANNEL_ID = 'wassilha_orders';
// Brand teal, identical to --primary / --brand in globals.css so the small
// status-bar icon and the notification accent match the rest of the app.
const BRAND_COLOR = '#0E6B5E';

/**
 * Normalise the caller-supplied data map into the shape FCM requires
 * (string values) and stamp the deep-link intent. Every push goes through
 * here so the tap behaviour is consistent across all notification types.
 */
function buildFcmData(
  data?: Record<string, string>
): Record<string, string> | undefined {
  const entries = Object.entries(data ?? {}).map(([k, v]) => [k, String(v)]);
  return { ...Object.fromEntries(entries), click_action: CLICK_ACTION };
}

/**
 * Android display config shared by the single + multicast paths so a tray
 * notification looks and behaves the same everywhere.
 *
 *  - `priority: 'high'` -> the message is delivered promptly even under
 *    Doze, and it is what makes the notification pop as a heads-up banner.
 *  - `channelId` -> must match the channel the client creates on launch.
 *  - `sound/icon/color` -> explicit, otherwise the device may fall back to
 *    a silent, iconless notification on some OEM skins.
 */
function buildAndroidConfig() {
  return {
    priority: 'high' as const,
    notification: {
      channelId: ANDROID_CHANNEL_ID,
      sound: 'default',
      icon: 'ic_launcher',
      color: BRAND_COLOR,
      defaultSound: true,
      defaultVibrateTimings: true,
      // Ongoing rides/orders are time-critical: keep them private on the
      // lockscreen (other riders shouldn't read the code) but visible.
      visibility: 'private' as const,
      // Group into one collapsible stack so a chatty day does not bury the
      // user; the latest notification wins the summary line.
      tag: 'wassilha',
    },
  };
}

/**
 * Send a single FCM notification to every registered device of the given
 * user. Best-effort: never throws, never blocks the caller on network
 * failures, and silently prunes tokens that the FCM backend reports as
 * invalid / unregistered (e.g. after the user uninstalled the app).
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<SendResult> {
  try {
    const tokens = await db.pushToken.findMany({
      where: { userId },
      select: { token: true, platform: true },
    });

    if (tokens.length === 0) {
      return { attempted: 0, successCount: 0, failureCount: 0, skipped: false };
    }

    const admin = initAdmin();
    if (!admin.messaging) {
      return {
        attempted: tokens.length,
        successCount: 0,
        failureCount: 0,
        skipped: true,
        reason: admin.reason,
      };
    }

    const fcmTokens = tokens.map((t) => t.token);
    // sendEachForMulticast (replaces the deprecated sendMulticast in
    // Firebase Admin SDK v12+): a single API call delivers to every
    // device of the user. Wrapped in a hard 5s ceiling so a slow FCM
    // response can never hang the calling Vercel function.
    const sendPromise = admin.messaging.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title, body },
      // data values must be strings per FCM contract; buildFcmData also
      // stamps the deep-link intent the client reads on tap.
      data: buildFcmData(data),
      android: buildAndroidConfig(),
      // iOS payload: sound + badge so the system shows the notification
      // with audio + bumps the app icon counter. Without this block FCM
      // still delivers, but the notification is silent and the badge
      // never updates -- which is why iOS users appeared not to receive
      // any push at all on early tests.
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        // Web fallback (installed PWA / browser notifications): the admin
        // SDK ignores the link without it, and a bare data-less message
        // shows a generic title. `logo.png` is the only raster asset we
        // ship in /public, so reuse it for both icon and badge.
        notification: {
          title,
          body,
          icon: '/logo.png',
          badge: '/logo.png',
          tag: 'wassilha',
          requireInteraction: false,
        },
        fcmOptions: {
          link: '/orders',
        },
      },
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('fcm-timeout')),
        FCM_TIMEOUT_MS
      );
    });
    let res: Awaited<typeof sendPromise>;
    try {
      res = await Promise.race([sendPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Prune tokens the FCM backend has marked as permanently invalid, so
    // we don't keep paying for dead tokens on every future dispatch.
    const deadTokenValues: string[] = [];
    res.responses.forEach((r, idx) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          deadTokenValues.push(fcmTokens[idx]);
        }
      }
    });
    if (deadTokenValues.length > 0) {
      // Best-effort cleanup; failures here are not surfaced.
      db.pushToken
        .deleteMany({ where: { token: { in: deadTokenValues } } })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[firebase-admin] failed to prune dead tokens:', e);
        });
    }

    return {
      attempted: fcmTokens.length,
      successCount: res.successCount,
      failureCount: res.failureCount,
      skipped: false,
    };
  } catch (e) {
    // Never let a push failure break the calling API route.
    // eslint-disable-next-line no-console
    console.warn(
      '[firebase-admin] sendPushNotification failed:',
      e instanceof Error ? e.message : String(e)
    );
    return { attempted: 0, successCount: 0, failureCount: 0, skipped: true, reason: 'error' };
  }
}

type BatchSendResult = {
  attempted: number;
  userCount: number;
  successCount: number;
  failureCount: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Send ONE FCM notification to every device of every user in userIds.
 *
 * Use this for fan-out scenarios (e.g. a new order needs to ping all
 * eligible drivers). The previous implementation called
 * sendPushNotification once per driver in a or...of loop, which
 * multiplied FCM round-trips by the number of online drivers (100
 * drivers = 100 separate FCM calls). This helper collapses the fan-out
 * to a single sendEachForMulticast against all collected tokens --
 * FCM accepts up to 500 tokens per call, so 100 drivers with ~1 device
 * each fit comfortably.
 *
 * Best-effort: never throws; prunes dead tokens the same way the
 * single-user helper does. Subject to the same 5s ceiling.
 */
export async function sendPushNotificationBatch(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<BatchSendResult> {
  const empty: BatchSendResult = {
    attempted: 0,
    userCount: 0,
    successCount: 0,
    failureCount: 0,
    skipped: false,
  };
  if (userIds.length === 0) return empty;

  try {
    const rows = await db.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (rows.length === 0) {
      return { ...empty, userCount: userIds.length };
    }

    const admin = initAdmin();
    if (!admin.messaging) {
      return {
        attempted: rows.length,
        userCount: userIds.length,
        successCount: 0,
        failureCount: 0,
        skipped: true,
        reason: admin.reason,
      };
    }

    const fcmTokens = rows.map((r) => r.token);
    // FCM caps a single sendEachForMulticast at 500 tokens. If we ever
    // exceed that, chunk the array and run sequentially. For the
    // current El Guerrara fleet this branch is unreachable, but the
    // guard keeps the helper safe if the city/region expands.
    let totalSuccess = 0;
    let totalFailure = 0;
    const deadTokenValues: string[] = [];
    for (let i = 0; i < fcmTokens.length; i += 500) {
      const chunk = fcmTokens.slice(i, i + 500);
      const sendPromise = admin.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data: buildFcmData(data),
        android: buildAndroidConfig(),
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
        webpush: {
          notification: {
            title,
            body,
            icon: '/logo.png',
            badge: '/logo.png',
            tag: 'wassilha',
          },
          fcmOptions: { link: '/orders' },
        },
      });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('fcm-timeout')),
          FCM_TIMEOUT_MS
        );
      });
      let res: Awaited<ReturnType<Messaging["sendEachForMulticast"]>>;
      try {
        res = await Promise.race([sendPromise, timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      totalSuccess += res.successCount;
      totalFailure += res.failureCount;
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          const code = r.error.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument'
          ) {
            deadTokenValues.push(chunk[idx]);
          }
        }
      });
    }

    if (deadTokenValues.length > 0) {
      db.pushToken
        .deleteMany({ where: { token: { in: deadTokenValues } } })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[firebase-admin] failed to prune dead tokens:', e);
        });
    }

    return {
      attempted: fcmTokens.length,
      userCount: userIds.length,
      successCount: totalSuccess,
      failureCount: totalFailure,
      skipped: false,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[firebase-admin] sendPushNotificationBatch failed:',
      e instanceof Error ? e.message : String(e)
    );
    return {
      attempted: 0,
      userCount: userIds.length,
      successCount: 0,
      failureCount: 0,
      skipped: true,
      reason: 'error',
    };
  }
}