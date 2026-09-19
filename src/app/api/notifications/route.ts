import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { notificationSelect } from '@/lib/dto';

// GET /api/notifications
// The signed-in user's own in-app notification log, newest first, paginated.
// Works for every role (customer / driver / artisan / admin).
//
// SECURITY: every query is scoped by session.id — there is no admin override
// and no client-supplied userId, so a user can never read another user's
// center.
//
// Query params:
//   page       1-based page number           (default 1)
//   pageSize   items per page                (default 20, capped at 50)
//   unreadOnly "1"/"true" -> only unread rows (default false)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const rawPage = Number(url.searchParams.get('page') ?? '1');
    const rawPageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const unreadOnly = ['1', 'true'].includes(
      (url.searchParams.get('unreadOnly') ?? '').toLowerCase(),
    );

    const page =
      Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    // Cap the page size so a hostile/buggy client cannot force a huge query.
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize >= 1
        ? Math.min(Math.floor(rawPageSize), 50)
        : 20;

    const where = {
      userId: session.id,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    // take + 1 avoids a second COUNT just to know whether to show "load more".
    const [rows, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize + 1,
      }),
      db.notification.count({ where }),
      db.notification.count({ where: { userId: session.id, isRead: false } }),
    ]);

    const hasMore = rows.length > pageSize;
    if (hasMore) rows.pop();

    return NextResponse.json({
      notifications: rows,
      total,
      unreadCount,
      page,
      pageSize,
      hasMore,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
