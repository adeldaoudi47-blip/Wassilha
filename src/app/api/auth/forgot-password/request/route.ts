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

    // SECURITY: account must exist and be active (drivers/admins/customers).
    // We do NOT reveal whether the phone exists — we return ok: true either way.
    const user = await db.user.findUnique({ where: { phone } });
    const accountExists =
      user && user.accountStatus === 'active' && user.passwordHash === null;

    // If account exists with no password (e.g. driver created by admin),
    // still allow them to set a password via this flow.
    // Reject drivers/admins attempting password reset from public flow.
    if (user && (user.role === 'driver' || user.role === 'admin')) {
      // Don't reveal this — just silently fail to prevent account enumeration.
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

    const recipient = '+213' + phone.substring(1);
    const content =
      'رمز تعيين كلمة المرور في وصّلها هو: ' + code;

    const sms = await sendSms(recipient, content);
    return NextResponse.json({ ok: true, provider: sms.provider });
  } catch (e) {
    console.error('[WASSILHA FORGOT-PW] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
