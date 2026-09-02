import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/pickup  (driver only)
//
// SECURITY: only the public subset of `User` fields is returned.
//
// SECURITY (V4): the status transition is a single atomic `updateMany`
// with a `status = 'accepted'` AND `driverId = session.id` guard. If
// two drivers are racing, only the assigned driver can flip the row
// from `accepted` to `picked`; the others (or a duplicate /pickup
// call) get count=0 and 409 invalidStatus. Previously a
// findUnique+update pattern allowed re-entry (e.g. tapping the
// "confirm pickup" button twice) and could produce a stale response.
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
    const claim = await db.order.updateMany({
      where: { id, status: 'accepted', driverId: session.id },
      data: { status: 'picked', pickedAt: new Date() },
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
    // Fire-and-forget: customer gets a heads-up that the driver has
    // arrived at the pickup point.
    void sendPushNotification(
      updated.customerId,
      'وصل السائق',
      'لقد وصل السائق إلى نقطة الاستلام، يرجى التوجه إليه.',
      { type: 'order_arrived', orderId: updated.id, orderCode: updated.code }
    ).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/pickup] push failed:', e);
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}