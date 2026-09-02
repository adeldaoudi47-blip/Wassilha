import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/rate  { score, comment? }  (customer who owns order, status delivered)
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const order = await db.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (order.status !== 'delivered') {
      return NextResponse.json({ error: 'notDelivered' }, { status: 409 });
    }
    if (!order.driverId) {
      return NextResponse.json({ error: 'noDriver' }, { status: 409 });
    }

    const { score, comment } = await req.json();
    if (typeof score !== 'number' || score < 1 || score > 5 || !Number.isInteger(score)) {
      return NextResponse.json({ error: 'invalidScore' }, { status: 400 });
    }

    // Update order with the rating score.
    await db.order.update({
      where: { id },
      data: { rating: score },
    });

    // Create the Rating record (one per order — guard against duplicates).
    const existingRating = await db.rating.findFirst({
      where: { orderId: id },
    });
    if (!existingRating) {
      await db.rating.create({
        data: {
          orderId: id,
          fromId: session.id,
          toId: order.driverId,
          score,
          comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null,
        },
      });
    }

    // Recompute the driver's average rating.
    // PERFORMANCE (V12 — N+1 fix): the old implementation pulled every
    // rating row for the driver into Node memory and summed them in JS.
    // For a driver with thousands of ratings that is O(N) network bytes
    // and O(N) JS work per rate event. `prisma.aggregate` computes the
    // average in a single SQL `AVG(score)` query and is constant-time
    // relative to the number of rows.
    const agg = await db.rating.aggregate({
      where: { toId: order.driverId },
      _avg: { score: true },
      _count: { _all: true },
    });
    if ((agg._count._all ?? 0) > 0 && agg._avg.score !== null) {
      const avg = Math.round(agg._avg.score * 10) / 10;
      await db.driver.update({
        where: { userId: order.driverId },
        data: { rating: avg },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
