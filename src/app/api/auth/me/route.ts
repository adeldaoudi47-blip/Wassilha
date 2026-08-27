import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ensureRealtime } from '@/lib/realtime-server';

// GET /api/auth/me — also boots the in-process realtime server as a side effect.
// For an authenticated driver, also returns the application status so the
// frontend can react to pending/rejected states.
export async function GET() {
  ensureRealtime();
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ user: null });
    }
    let driverApplicationStatus: string | null = null;
    if (user.role === 'driver') {
      const driver = await db.driver.findUnique({
        where: { userId: user.id },
        select: { applicationStatus: true },
      });
      driverApplicationStatus = driver?.applicationStatus ?? null;
    }
    return NextResponse.json({ user, driverApplicationStatus });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
