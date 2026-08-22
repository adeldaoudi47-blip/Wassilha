import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ensureRealtime } from '@/lib/realtime-server';

// GET /api/auth/me — also boots the in-process realtime server as a side effect.
export async function GET() {
  ensureRealtime();
  try {
    const user = await getSession();
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
