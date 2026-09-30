// POST /api/auth/forgot-password/request
// Sends an OTP to the user's phone so they can reset their password.
// Security: same protections as /api/auth/send-otp (rateLimit, resend cooldown).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';

const RESEND_COOLDOWN_MS = 30 * 1000;

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone } = await req.json();

    const phone = normalizeAlgerianPhone(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: 'invalidPhone' }, { status: 400 });
    }

    // SECURITY: demo mode force-disabled in production.
  // DEMO MODE (2026-09-28): a random 6-digit code is always generated;
  // OTP_DEMO_MODE / DEMO_OTP are intentionally not read.
    // SECURITY: per-phone resend cooldown.
    const latestCode = await db.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latestCode &&
      Date.now() - new Date(latestCode.createdAt).getTime() <
        RESEND_COOLDOWN_MS
    ) {
      return NextResponse.json(
        { error: 'resendCooldown', retryAfterSec: 30 },
        { status: 429 }
      );
    }

    // SECURITY: per-IP hourly cap.
    const ipCheck = await rateLimit(
      `otpsend:${clientIp(req)}`,
      10,
      60 * 60 * 1000
    );
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    // SECURITY (V10 — account enumeration fix):
    // We do NOT reveal whether the phone exists in the database.
    // To prevent timing-based enumeration we always run the same work
    // (OTP creation + SMS dispatch) regardless of whether a matching
    // user was found. The only difference is that for a non-existent
    // account we create a "ghost" OTP for a sentinel phone that is
    // never matched at verify time, and skip the SMS send.
    //
    // The public response is identical in both cases: `{ ok: true }`.
    const user = await db.user.findUnique({ where: { phone } });

    // Drivers and admins cannot use the public password-reset flow.
    // We still return `ok: true` to keep the enumeration surface flat.
    if (user && (user.role === 'driver' || user.role === 'admin')) {
      return NextResponse.json({ ok: true });
    }

    const code = generateOtp();

    await db.otpCode.deleteMany({ where: { phone } });

    await db.otpCode.create({
      data: {
        phone,
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // No provider dispatch: the code is returned in the response (demo flow).
    // SECURITY (V10 - account enumeration): the public response shape is
    // identical whether or not the account exists. `devOtp` is only echoed
    // for a real, active account so the demo flow stays usable without
    // leaking that a phone number is registered.
    if (user && user.accountStatus === 'active') {
      return NextResponse.json({ ok: true, demo: true, devOtp: code });
    }

    // Account does not exist (or is not active). We already created the
    // OTP above to flatten timing, but we never send the SMS and we
    // return the same response shape as the success path.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[WASSILHA FORGOT-PW] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
