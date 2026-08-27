// POST /api/auth/forgot-password/reset
// Verifies the OTP (from the forgot-password request flow) and sets a new password.
// Security: same OTP protections as /api/auth/verify-otp (attempts limit, expiry).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getVerifiedPhone, hashPassword, setSession } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import type { AuthUser, Role } from '@/lib/types';

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export async function POST(req: NextRequest) {
  try {
    const phone = await getVerifiedPhone();
    if (!phone) {
      return NextResponse.json(
        { error: 'phoneVerificationRequired' },
        { status: 403 }
      );
    }

    const { code, password, confirmPassword } = await req.json();

    // SECURITY: demo mode force-disabled in production.
    const demoMode =
      process.env.OTP_DEMO_MODE === 'true' &&
      process.env.NODE_ENV !== 'production';

    const plausible = demoMode
      ? typeof code === 'string' && code.length >= 4
      : typeof code === 'string' && /^\d{6}$/.test(code);
    if (!plausible) {
      return NextResponse.json({ error: 'invalidOtp' }, { status: 400 });
    }

    // SECURITY: per-IP verification cap.
    const ipCheck = await rateLimit(
      `otpverify:${clientIp(req)}`,
      30,
      15 * 60 * 1000
    );
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyAttempts', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    const otp = await db.otpCode.findFirst({
      where: { phone },
      orderBy: { expiresAt: 'desc' },
    });

    if (!otp || new Date(otp.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'invalidOtp' }, { status: 400 });
    }

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
      return NextResponse.json({ error: 'invalidOtp' }, { status: 400 });
    }

    // OTP is valid — delete it immediately.
    await db.otpCode.deleteMany({ where: { phone } });

    // Validate new password.
    if (typeof password !== 'string' || !PASSWORD_RE.test(password)) {
      return NextResponse.json(
        { error: 'weakPassword' },
        { status: 400 }
      );
    }
    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'passwordMismatch' },
        { status: 400 }
      );
    }

    // Find the user and update password.
    const user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      return NextResponse.json(
        { error: 'userNotFound' },
        { status: 404 }
      );
    }

    // Drivers/admins must not reset via public flow.
    if (user.role === 'driver' || user.role === 'admin') {
      return NextResponse.json(
        { error: 'operationNotAllowed' },
        { status: 403 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Revoke all existing sessions (logout everywhere).
    await db.session.deleteMany({ where: { userId: user.id } });

    // Update password and activate account if it wasn't.
    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        accountStatus: 'active',
        phoneVerified: true,
      },
    });

    // Create a new session for the user.
    await setSession(updatedUser.id);

    const authUser: AuthUser = {
      id: updatedUser.id,
      phone: updatedUser.phone,
      name: updatedUser.name,
      role: updatedUser.role as Role,
      avatar: updatedUser.avatar,
    };

    return NextResponse.json({ user: authUser });
  } catch (e) {
    console.error('[WASSILHA FORGOT-PW RESET] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
