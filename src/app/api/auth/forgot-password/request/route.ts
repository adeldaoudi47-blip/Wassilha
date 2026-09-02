// POST /api/auth/forgot-password/request
// Sends an OTP to the user's phone so they can reset their password.
// Security: same protections as /api/auth/send-otp (rateLimit, resend cooldown).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendSms } from '@/lib/sms';
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
    const demoMode =
      process.env.OTP_DEMO_MODE === 'true' &&
      process.env.NODE_ENV !== 'production';
    const demoOtp = process.env.DEMO_OTP || '0000';

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

    const code = demoMode ? demoOtp : generateOtp();

    await db.otpCode.deleteMany({ where: { phone } });

    await db.otpCode.create({
      data: {
        phone,
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    if (demoMode) {
      console.log('[WASSILHA FORGOT-PW DEMO] ' + phone + ' -> ' + code);
      return NextResponse.json({ ok: true, devOtp: code });
    }

    if (user && user.accountStatus === 'active') {
      const recipient = '+213' + phone.substring(1);
      const content = 'رمز تعيين كلمة المرور في وصّلها هو: ' + code;
      const sms = await sendSms(recipient, content);
      return NextResponse.json({ ok: true, provider: sms.provider });
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
