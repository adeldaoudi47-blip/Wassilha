import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/cancel  (customer owner or assigned driver)
export async function POST(_req: NextRequest, { params }: Ctx) {
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

    const isOwner = order.customerId === session.id;
    const isAssignedDriver =
      order.driverId === session.id && session.role === 'driver';
    const isAdmin = session.role === 'admin';
    if (!isOwner && !isAssignedDriver && !isAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }

    const updated = await db.order.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
      include: { customer: true, driver: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
