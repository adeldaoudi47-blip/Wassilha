// ---------------------------------------------------------------------------
// PHASE 8 — OTP DELIVERY (single source of truth).
//
// Before this module, `/api/auth/send-otp` and `/api/auth/forgot-password/request`
// generated a code, logged it, and returned it to the caller as `devOtp`. That is
// a full account-takeover path: anyone who knows a phone number can read that
// person's login code and sign in as them. It existed because no SMS provider
// was wired up, so removing it naively would have locked every user out.
//
// This module closes the hole properly instead of trading it for a lockout:
//
//   PRODUCTION  -> the code is delivered through the configured provider
//                  (`sendSms`, already implemented in lib/sms.ts) and the HTTP
//                  response NEVER contains the code, in any field.
//   DEV/TEST    -> only when OTP_DEMO_MODE === 'true' AND NODE_ENV !==
//                  'production'. The flag is deliberately NOT satisfied by a
//                  missing provider: an unconfigured provider must not silently
//                  downgrade to "return the code to the caller".
//
// The code is never logged, never included in an error, and never placed in a
// header. Reuses the existing OTP_DEMO_MODE convention already read by
// /api/auth/verify-otp and /api/auth/forgot-password/reset.
// ---------------------------------------------------------------------------
import { sendSms } from './sms';

/**
 * True ONLY when the operator has explicitly opted into the dev affordance
 * AND this is not a production build. A provider being unconfigured is never
 * sufficient to enable it.
 */
export function isOtpDemoMode(): boolean {
  return (
    process.env.OTP_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production'
  );
}

/**
 * Closed-testing affordance for PREVIEW deployments only.
 *
 * VERCEL_ENV is set by Vercel itself: 'production' on production deploys,
 * 'preview' on every preview build, and undefined on local `next dev`. The
 * explicit `=== 'preview'` means this can never be satisfied by an unset or
 * unexpected value, and a production deployment is structurally excluded.
 *
 * SECURITY: preview builds share the production DATABASE_URL, so this is only
 * as safe as the preview URL being inaccessible to the public. Pair it with
 * Vercel Deployment Protection (or keep preview traffic to trusted testers).
 */
export function isOtpPreviewDemo(): boolean {
  return process.env.VERCEL_ENV === 'preview';
}

/**
 * The operator-facing SMS body. Kept in one place so the two OTP entry points
 * cannot drift, and so the code text exists in exactly one string.
 */
export function otpMessage(code: string): string {
  return `Wassilha: votre code de vérification est ${code}. Ne le communiquez à personne.`;
}

export interface OtpDeliveryResult {
  /** True when the code actually reached a provider. */
  delivered: boolean;
  /** True when we deliberately skipped the provider (dev mode only). */
  skipped: boolean;
  /** Provider id on success, for server-side diagnostics that carry NO code. */
  provider?: string;
}

/**
 * Deliver an OTP. Never throws and never returns the code to the caller.
 *
 * A provider failure is reported as `delivered: false` so the calling route can
 * surface a generic "we could not send a code" response. It deliberately does NOT
 * fall back to returning the code in the response — that would reintroduce the
 * exact vulnerability this module exists to remove.
 */
export async function deliverOtp(
  phone: string,
  code: string
): Promise<OtpDeliveryResult> {
  if (isOtpDemoMode()) {
    return { delivered: false, skipped: true };
  }
  try {
    const result = await sendSms(phone, otpMessage(code));
    return { delivered: true, skipped: false, provider: result.provider };
  } catch (e) {
    // Log the failure WITHOUT the code, so on-call can see a provider outage
    // without the log pipeline becoming a second code-exfiltration channel.
    console.error(
      '[otp] delivery failed for phone',
      phone.slice(0, 4) + '***' + phone.slice(-2),
      ':',
      e instanceof Error ? e.message : String(e)
    );
    return { delivered: false, skipped: false };
  }
}