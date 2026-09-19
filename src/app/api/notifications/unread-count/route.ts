import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/notifications/unread-count
// Lightweight badge count for the notification bell. Returns only the number
// so the UI can poll it cheaply — the list endpoint returns the same value,
// but this one transfers no rows.
//
// SECURITY: scoped to session.id; no client input is accepted at all.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const unreadCount = await db.notification.count({
      where: { userId: session.id, isRead: false },
    });

    return NextResponse.json({ unreadCount });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
