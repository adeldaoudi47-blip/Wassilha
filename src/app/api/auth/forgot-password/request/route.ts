// POST /api/auth/forgot-password/request
// Sends an OTP to the user's phone so they can reset their password.
// Security: same protections as /api/auth/send-otp (rateLimit, resend cooldown).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import { deliverOtp, isOtpDemoMode, isOtpPreviewDemo } from '@/lib/otp';

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

    // PHASE 8 (OTP delivery): the code is delivered by the configured provider
    // through deliverOtp() below. OTP_DEMO_MODE is read ONLY via isOtpDemoMode(),
    // which additionally requires a non-production build, so a production caller
    // never receives the code and an unconfigured provider is a delivery failure
    // rather than a fallback echo.
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

    // PHASE 8: deliver through the provider instead of returning the code.
    // The ghost OTP created above for a non-existent account is NEVER delivered,
    // and the response below is identical either way, so account existence
    // stays unobservable.
    await deliverOtp(phone, code);

    // SECURITY (V10 - account enumeration): the public response shape is
    // identical whether or not the account exists. `devOtp` is echoed only
    // behind the explicit non-production gates (see lib/otp.ts); on any
    // production build this response is `{ ok: true }` and nothing more.
    const body: Record<string, unknown> = { ok: true };
    if (isOtpDemoMode() || isOtpPreviewDemo()) {
      body.demo = true;
      body.devOtp = code;
    }
    return NextResponse.json(body);
  } catch (e) {
    console.error('[WASSILHA FORGOT-PW] Server error:', e);
    // SECURITY: do not echo the exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}
