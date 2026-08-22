import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEMO_OTP, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

const PHONE_RE = /^0[567]\d{8}$/;

// POST /api/auth/verify-otp  { phone, code, name? }
export async function POST(req: NextRequest) {
  try {
    const { phone, code, name } = await req.json();
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
      return NextResponse.json({ error: 'invalidPhone' }, { status: 400 });
    }
    if (typeof code !== 'string' || code !== DEMO_OTP) {
      return NextResponse.json({ error: 'invalidOtp' }, { status: 400 });
    }

    let user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      user = await db.user.create({
        data: {
          phone,
          name: typeof name === 'string' && name.trim() ? name.trim() : 'زبون جديد',
          role: 'customer',
        },
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
    return NextResponse.json({ user: authUser });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
