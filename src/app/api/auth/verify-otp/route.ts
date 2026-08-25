import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setPhoneVerification, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

const PHONE_RE = /^0[567]\d{8}$/;

export async function POST(req: NextRequest) {
  try {
    const { phone, code, name } = await req.json();

    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: 'invalidPhone' },
        { status: 400 }
      );
    }

    const demoMode = process.env.OTP_DEMO_MODE === 'true';
    const demoOtp = process.env.DEMO_OTP || '0000';

    // Demo mode uses the 4-digit code shown by the local app.
    if (demoMode) {
      if (typeof code !== 'string' || code !== demoOtp) {
        return NextResponse.json(
          { error: 'invalidOtp' },
          { status: 400 }
        );
      }
    } else {
      // Production SMS OTP uses 6 digits.
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return NextResponse.json(
          { error: 'invalidOtp' },
          { status: 400 }
        );
      }
    }

    const otp = await db.otpCode.findFirst({
      where: {
        phone,
        code,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        expiresAt: 'desc',
      },
    });

    if (!otp) {
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
    });

    if (!user || user.accountStatus !== 'active') {
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
    return NextResponse.json(
      {
        error: 'serverError',
        detail: String(e),
      },
      { status: 500 }
    );
  }
}
