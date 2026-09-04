import { NextResponse } from 'next/server';
import { clearSession, getSession } from '@/lib/auth';
import { db } from '@/lib/db';

// POST /api/auth/logout
//
// SECURITY (V13): best-effort cleanup of every FCM token owned by the
// logging-out user. Without this, a device handed to another person
// (or a lost/stolen device) would keep receiving the previous user's
// push notifications until the tokens are rejected by FCM as
// "registration-token-not-registered" -- a window of days/weeks.
//
// The cleanup runs AFTER clearSession() (so the cookie is gone) but
// uses the session.id that was captured BEFORE the cookie was cleared.
// Failures here are swallowed so a transient DB issue cannot block the
// logout response itself.
export async function POST() {
  try {
    // Read session.id FIRST, then clear the cookie, then delete the
    // tokens. If the cookie was already gone (e.g. expired browser
    // session), getSession() returns null and we skip cleanup.
    const session = await getSession();
    await clearSession();
    if (session) {
      try {
        await db.pushToken.deleteMany({ where: { userId: session.id } });
      } catch {
        // best-effort: never let token cleanup fail the logout itself
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
