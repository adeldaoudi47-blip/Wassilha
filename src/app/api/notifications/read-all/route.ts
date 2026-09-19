import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/notifications/read-all
// Marks ALL of the caller's unread notifications as read. No body required.
//
// SECURITY: scoped to session.id only — the WHERE clause contains no id from
// the client, so it can never touch another user's rows.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await db.notification.updateMany({
      where: { userId: session.id, isRead: false },
      data: { isRead: true },
    });

    return NextResponse.json({ ok: true, updated: result.count });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
