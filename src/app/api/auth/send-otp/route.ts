import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import { deliverOtp, isOtpDemoMode, isOtpPreviewDemo } from '@/lib/otp';

// Matches the 30s resend timer already enforced by the frontend UI.
const RESEND_COOLDOWN_MS = 30 * 1000;

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone } = await req.json();

    // SECURITY + UX: accept every local/international Algerian representation
    // (+213 / 00213 / spaces / dashes / invisible keyboard marks) and normalize
    // to the exact canonical form shared with the frontend before any DB work.
    const phone = normalizeAlgerianPhone(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: 'invalidPhone' }, { status: 400 });
    }

    // PHASE 8 (OTP delivery): the code is delivered by the configured provider
    // through deliverOtp() below. OTP_DEMO_MODE is read ONLY via isOtpDemoMode(),
    // which additionally requires a non-production build, so a production caller
    // can never receive the code. An unconfigured provider is a delivery failure,
    // never a fallback that echoes the code back to the caller.
    // SECURITY: per-phone resend cooldown - the newest stored code must be older
    // than the cooldown window before another SMS can be triggered.
    const latestCode = await db.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latestCode &&
      Date.now() - new Date(latestCode.createdAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      return NextResponse.json(
        { error: 'resendCooldown', retryAfterSec: Math.ceil(RESEND_COOLDOWN_MS / 1000) },
        { status: 429 }
      );
    }

    // SECURITY: per-IP hourly cap - protects the SMS budget from pumping abuse.
    const ipCheck = await rateLimit(`otpsend:${clientIp(req)}`, 10, 60 * 60 * 1000);
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    const code = generateOtp();

    // DB HYGIENE (V13 - OTP table cleanup): wipe expired OTPs first so the table
    // does not grow unbounded with rows nobody can ever verify. This runs on
    // every OTP send and keeps the table small.
    await db.otpCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    await db.otpCode.deleteMany({ where: { phone } });

    await db.otpCode.create({
      data: {
        phone,
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // PHASE 8: deliver the code through the configured provider instead of
    // returning it. deliverOtp never puts the code in the response or the logs.
    await deliverOtp(phone, code);

    // DIAG: confirms the row persisted WITHOUT printing the code. The previous
    // log lines echoed it, which made the log pipeline a code-exfiltration
    // channel in its own right.
    console.log('[SEND-OTP] Saved OTP for phone:', phone);

    // SECURITY (Phase 8): the response shape is identical for every caller and
    // never reveals the code. The code is echoed ONLY behind an explicit
    // non-production gate: OTP_DEMO_MODE on a dev build, or a Vercel PREVIEW
    // deployment. On a production build both are false, so the response is
    // `{ ok: true }` and the code never leaves the server.
    const body: Record<string, unknown> = { ok: true };
    if (isOtpDemoMode() || isOtpPreviewDemo()) {
      body.demo = true;
      body.devOtp = code;
    }
    return NextResponse.json(body);
  } catch (e) {
    console.error('[SEND-OTP] Error:', e);

    // SECURITY: never echo the exception detail - a Prisma error can embed
    // values from the row we just wrote.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}