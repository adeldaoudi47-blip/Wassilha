import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/accept  (driver only)
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
    if (order.status !== 'searching') {
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }

    // Ensure the logged-in driver actually has a Driver profile.
    const driver = await db.driver.findUnique({
      where: { userId: session.id },
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 403 });
    }

    const updated = await db.order.update({
      where: { id },
      data: {
        driverId: session.id,
        status: 'accepted',
        acceptedAt: new Date(),
      },
      include: { customer: true, driver: true },
    });
    // Fire-and-forget: tell the customer their order was accepted.
    void sendPushNotification(
      updated.customerId,
      'تم قبول طلبك',
      'السائق في طريقه إليك الآن.',
      { type: 'order_accepted', orderId: updated.id, orderCode: updated.code }
    ).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/accept] push failed:', e);
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
