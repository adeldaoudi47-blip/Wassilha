// HIRFA Phase 3 — POST /api/craft/reviews/[id]/like
//
// Toggles a "helpful" vote on a review: creates the vote if the caller has not
// voted yet (likeCount +1), or removes it if they have (likeCount -1). One vote
// per user per review, enforced by the @@unique([reviewId, userId]) index —
// the idempotent toggle means double-clicking the button never inflates the
// count.
//
// SECURITY: any logged-in user may vote (a helpful vote is a shopper's
// opinion, not store data), but the vote is always scoped to the caller's own
// session id — nobody can vote on someone else's behalf.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const review = await db.craftReview.findUnique({ where: { id }, select: { id: true } });
    if (!review) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    // Upsert: create the vote, or undo it if it already exists. The atomic
    // likeCount update is inside the same transaction as the vote row, so the
    // counter and the vote table can never drift apart.
    const existing = await db.reviewLike.findUnique({
      where: { reviewId_userId: { reviewId: id, userId: session.id } },
      select: { id: true },
    });

    if (existing) {
      await db.$transaction([
        db.reviewLike.delete({ where: { id: existing.id } }),
        db.craftReview.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
      ]);
      return NextResponse.json({ ok: true, liked: false, likeCount: null });
    }

    await db.$transaction([
      db.reviewLike.create({ data: { reviewId: id, userId: session.id } }),
      db.craftReview.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
    ]);
    return NextResponse.json({ ok: true, liked: true, likeCount: null }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
