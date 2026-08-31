import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/notifications/register
// Body: { token: string; platform: 'android' | 'ios' | 'web' }
// Persists the FCM token for the currently signed-in user. Re-uses the same
// row when the same FCM token is reported (e.g. after a re-install or a
// re-login on the same device) by relying on the `token` UNIQUE constraint
// and updating `userId` + `updatedAt` to the latest owner. This avoids
// duplicates while still allowing a token to be reassigned to a different
// account.
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'invalidJson' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'invalidBody' },
        { status: 400 }
      );
    }

    const { token, platform } = body as { token?: unknown; platform?: unknown };

    if (typeof token !== 'string' || token.length < 8 || token.length > 4096) {
      return NextResponse.json(
        { error: 'invalidToken' },
        { status: 400 }
      );
    }

    const allowedPlatforms = new Set(['android', 'ios', 'web']);
    const platformStr = typeof platform === 'string' ? platform.toLowerCase() : '';
    const platformFinal = allowedPlatforms.has(platformStr)
      ? (platformStr as 'android' | 'ios' | 'web')
      : 'android';

    // Upsert by the UNIQUE token. If the token already exists under another
    // user (e.g. device hand-off, logout/login on shared hardware), reassign
    // it to the current user. We never delete a token here — explicit unregister
    // is the job of a dedicated endpoint, added later if needed.
    const saved = await db.pushToken.upsert({
      where: { token },
      create: {
        token,
        platform: platformFinal,
        userId: session.id,
      },
      update: {
        userId: session.id,
        platform: platformFinal,
      },
      select: { id: true, platform: true, updatedAt: true },
    });

    return NextResponse.json({ ok: true, pushToken: saved });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
