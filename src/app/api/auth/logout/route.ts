import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth';

// POST /api/auth/logout
export async function POST() {
  try {
    await clearSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
