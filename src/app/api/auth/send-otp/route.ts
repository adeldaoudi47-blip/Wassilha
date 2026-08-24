import { NextRequest, NextResponse } from 'next/server';
import { DEMO_OTP } from '@/lib/auth';

const PHONE_RE = /^0[567]\d{8}$/;

// POST /api/auth/send-otp  { phone }
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: 'invalidPhone' },
        { status: 400 }
      );
    }
    // Demo mode — no real SMS. Always returns the dev OTP.
    return NextResponse.json({ ok: true, devOtp: DEMO_OTP });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
