import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/deliver  (driver only)
//
// SECURITY: only the public subset of `User` fields is returned.
//
// SECURITY (V4): atomic status transition. A `picked -> delivered`
// flip can only be performed by the assigned driver for a row still in
// `picked` state; duplicate /deliver calls or racing drivers get 409.
//
// SECURITY (V12): driver rating is recomputed via a SQL `aggregate`
// (single round-trip) instead of `findMany`+`reduce` in JS. The
// previous N+1 pattern scaled O(n_ratings) per /deliver call.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const now = new Date();
    const claim = await db.order.updateMany({
      where: { id, status: 'picked', driverId: session.id },
      data: { status: 'delivered', deliveredAt: now },
    });
    if (claim.count === 0) {
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }

    const updated = await db.order.findUnique({
      where: { id },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
    });
    if (!updated) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    // Update driver aggregates: totalTrips + 1, totalEarnings += price,
    // and a fresh rating average via a single SQL aggregate (V12).
    const driverId = updated.driverId;
    if (driverId) {
      const agg = await db.rating.aggregate({
        where: { toId: driverId },
        _avg: { score: true },
      });
      const newRating =
        agg._avg.score !== null
          ? Math.round(agg._avg.score * 10) / 10
          : 0;

      await db.driver.update({
        where: { userId: driverId },
        data: {
          totalTrips: { increment: 1 },
          totalEarnings: { increment: updated.price },
          rating: newRating,
        },
      });
    }

    // Fire-and-forget: thank the customer and close the loop.
    void sendPushNotification(
      updated.customerId,
      'اكتملت الرحلة',
      'شكراً لاستخدامك وَصّلها. نأمل أن نراك مرة أخرى!',
      { type: 'order_delivered', orderId: updated.id, orderCode: updated.code }
    ).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/deliver] push failed:', e);
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}