// Server-side Firebase Admin SDK wrapper.
//
// Initializes the Admin SDK exactly once per Node process from environment
// variables. Service-account credentials must NEVER be hard-coded here —
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
    // sendMulticast: a single API call delivers to all of the user's devices.
    const res = await admin.messaging.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title, body },
      // data values must be strings per FCM contract.
      data: data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          )
        : undefined,
      android: {
        priority: 'high',
        notification: {
          channelId: 'wassilha_default',
          // Click action resolves in MainActivity; for now we rely on
          // the app-shell to handle deep links via app state.
        },
      },
    });

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
