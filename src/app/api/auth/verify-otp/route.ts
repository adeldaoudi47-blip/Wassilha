import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setPhoneVerification, setSession } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import type { AuthUser, Role } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone, code, name } = await req.json();

    // SECURITY + UX: identical normalization to send-otp / frontend, so both
    // sides always agree and the stored code always maps to one canonical
    // phone per user.
    const phone = normalizeAlgerianPhone(rawPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'invalidPhone' },
        { status: 400 }
      );
    }

    // SECURITY: demo mode is force-disabled in production regardless of env.
    const demoMode =
      process.env.OTP_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';

    // Plausibility check only — exact matching happens against the stored row
    // below, so every failed attempt can be counted for brute-force defense.
    const plausible = demoMode
      ? typeof code === 'string' && code.length >= 4 && code.length <= 8
      : typeof code === 'string' && /^\d{6}$/.test(code);
    if (!plausible) {
      return NextResponse.json(
        { error: 'invalidOtp' },
        { status: 400 }
      );
    }

    // SECURITY: per-IP verification cap (brute-force budget per attacker).
    const ipCheck = await rateLimit(`otpverify:${clientIp(req)}`, 30, 15 * 60 * 1000);
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyAttempts', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    const otp = await db.otpCode.findFirst({
      where: { phone },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // No live code for this phone (never sent / expired).
    if (!otp || new Date(otp.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'invalidOtp' },
        { status: 400 }
      );
    }

    // SECURITY: max 5 attempts per code — after that the code is dead even
    // if the correct digits are finally supplied.
    if (otp.attempts >= 5) {
      return NextResponse.json(
        { error: 'tooManyAttempts' },
        { status: 429 }
      );
    }

    if (otp.code !== code) {
      await db.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json(
        { error: 'invalidOtp' },
        { status: 400 }
      );
    }

    await db.otpCode.deleteMany({
      where: { phone },
    });

    const user = await db.user.findUnique({
      where: { phone },
      include: { driver: true },
    });

    if (!user || user.accountStatus !== 'active') {
      // SECURITY: a pending/rejected driver cannot receive a session.
      // If they are an existing driver (pending or rejected), surface that
      // specific state so the frontend can show a useful message.
      if (user && user.role === 'driver' && user.driver) {
        await setPhoneVerification(phone);
        return NextResponse.json({
          requiresSignup: false,
          driverApplicationPending: user.driver.applicationStatus === 'pending',
          driverApplicationRejected: user.driver.applicationStatus === 'rejected',
          phone,
        });
      }
      // New user (or pre-signup incomplete customer) — go to signup.
      await setPhoneVerification(phone);
      return NextResponse.json({
        requiresSignup: true,
        phone,
      });
    }

    await setSession(user.id);

    const authUser: AuthUser = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role as Role,
      avatar: user.avatar,
    };

    return NextResponse.json({
      user: authUser,
    });
  } catch (e) {
    console.error('[WASSILHA VERIFY-OTP ERROR]', e);
    return NextResponse.json(
      {
        error: 'serverError',
        detail: String(e),
      },
      { status: 500 }
    );
  }
}
