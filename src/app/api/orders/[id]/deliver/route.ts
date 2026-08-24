import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/deliver  (driver only)
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
    const order = await db.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (order.driverId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (order.status !== 'picked') {
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }

    const now = new Date();
    const updated = await db.order.update({
      where: { id },
      data: {
        status: 'delivered',
        deliveredAt: now,
      },
      include: { customer: true, driver: true },
    });

    // Update driver aggregates: totalTrips + 1, totalEarnings += price.
    if (order.driverId) {
      const driver = await db.driver.findUnique({
        where: { userId: order.driverId },
      });
      if (driver) {
        // Recompute rating average if the order had a rating.
        let newRating = driver.rating;
        if (order.rating) {
          const allRatings = await db.rating.findMany({
            where: { toId: order.driverId },
            select: { score: true },
          });
          if (allRatings.length > 0) {
            const sum = allRatings.reduce((s, r) => s + r.score, 0);
            newRating =
              Math.round((sum / allRatings.length) * 10) / 10;
          }
        }
        await db.driver.update({
          where: { userId: order.driverId },
          data: {
            totalTrips: { increment: 1 },
            totalEarnings: { increment: order.price },
            rating: newRating,
          },
        });
      }
    }

    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
