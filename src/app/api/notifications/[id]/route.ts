import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/notifications/[id]
// Marks ONE notification as read (or unread when isRead=false). Only the
// notification's owner may change it.
//
// SECURITY: the WHERE clause is { id, userId: session.id }. A guessed id that
// belongs to another user matches zero rows -> 404, never a silent update and
// never an "exists but forbidden" oracle.
const patchSchema = z.object({
  isRead: z.boolean().default(true),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalidInput', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // updateMany (not update) so userId can ride along in the WHERE clause.
    const result = await db.notification.updateMany({
      where: { id, userId: session.id },
      data: { isRead: parsed.data.isRead },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      id,
      isRead: parsed.data.isRead,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
