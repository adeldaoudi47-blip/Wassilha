import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/notifications/unregister
// Body (optional): { token?: string }
//   - With { token }: deletes that single FCM token if it belongs to the
//     currently signed-in user.
//   - Without body: deletes ALL PushTokens belonging to the user.
//
// SECURITY: deletion is always scoped to session.id; a caller can never
// delete another user's token, even if they guess the token value,
// because the WHERE clause is { userId: session.id }.
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 }
      );
    }

    let token: string | null = null;
    try {
      const ct = req.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await req.json();
        if (body && typeof body === 'object') {
          const t = (body as { token?: unknown }).token;
          if (typeof t === 'string' && t.length >= 8 && t.length <= 4096) {
            token = t;
          }
        }
      }
    } catch {
      // Empty body or malformed JSON -> unregister all.
    }

    const result = token
      ? await db.pushToken.deleteMany({
          where: { userId: session.id, token },
        })
      : await db.pushToken.deleteMany({
          where: { userId: session.id },
        });

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
