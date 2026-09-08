import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/craft/orders/[id]/rate
//
// SECURITY (IDOR protection):
//   - Only the customer who owns the craft order can rate it
//   - The order must be in 'delivered' status
//   - The order must not have been rated yet (one rating per order)
//
// Body: { score: 1-5, comment?: string }
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalidInput' }, { status: 400 });
    }

    const { score, comment } = body;

    // Validate score: must be integer 1-5
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: 'invalidScore' }, { status: 400 });
    }

    // Fetch the craft order
    const craftOrder = await db.craftOrder.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        artisanId: true,
        status: true,
        code: true,
      },
    });

    if (!craftOrder) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    // IDOR: verify the customer owns this order
    if (craftOrder.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Verify order is delivered
    if (craftOrder.status !== 'delivered') {
      return NextResponse.json({ error: 'notDelivered' }, { status: 409 });
    }

    // Check if already rated (one rating per craft order)
    const existingRating = await db.craftReview.findFirst({
      where: { craftOrderId: id },
    });

    if (existingRating) {
      return NextResponse.json({ error: 'alreadyRated' }, { status: 409 });
    }

    // Get the artisan's userId for updating their profile rating
    const artisan = await db.artisanProfile.findUnique({
      where: { id: craftOrder.artisanId },
      select: { userId: true },
    });

    // Create the craft review
    await db.craftReview.create({
      data: {
        craftOrderId: id,
        fromId: session.id,
        toId: craftOrder.artisanId,
        score,
        comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null,
      },
    });

    // Update artisan's average rating using SQL aggregate (constant-time)
    const agg = await db.craftReview.aggregate({
      where: { toId: craftOrder.artisanId },
      _avg: { score: true },
      _count: { _all: true },
    });

    if ((agg._count._all ?? 0) > 0 && agg._avg.score !== null) {
      const avg = Math.round(agg._avg.score * 10) / 10;
      await db.artisanProfile.update({
        where: { id: craftOrder.artisanId },
        data: { rating: avg },
      });
    }

    // Increment total sales for the artisan
    await db.artisanProfile.update({
      where: { id: craftOrder.artisanId },
      data: { totalSales: { increment: 1 } },
    });

    return NextResponse.json({ ok: true, message: 'ratingCreated' });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
