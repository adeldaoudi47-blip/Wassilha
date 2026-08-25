import { NextResponse } from 'next/server';
import { getVerifiedPhone } from '@/lib/auth';

export async function GET() {
  try {
    const phone = await getVerifiedPhone();
    return NextResponse.json({ pendingSignup: Boolean(phone), phone });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}