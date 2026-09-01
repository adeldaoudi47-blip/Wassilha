import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/pickup  (driver only)
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
    if (order.status !== 'accepted') {
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }

    const updated = await db.order.update({
      where: { id },
      data: {
        status: 'picked',
        pickedAt: new Date(),
      },
      include: { customer: true, driver: true },
    });
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
