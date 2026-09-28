import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOrderStatus } from '@/lib/pusher-server';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/cancel  (customer owner or assigned driver)
//
// SECURITY: only the public subset of `User` fields is returned.
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
      // Same 409 the guarded write below produces, surfaced before we open a
      // transaction for the common "already finished" tap.
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }

    // PHASE 5 - GUARDED CANCEL + NEGOTIATION CLEANUP, ATOMICALLY.
    //
    // V4 hardened the other status routes but left this one on a bare
    // `order.update`: the status check above and the write were two separate
    // round-trips, so a driver's /deliver landing in between could be
    // overwritten by the cancellation (or vice versa) and the loser still got
    // a 200 whose body no longer matched the database. The write is now a
    // conditional `updateMany` that re-checks the status under the row lock.
    //
    // The cancellation also closes the negotiation: every pending bid on a
    // cancelled order is unwinnable, so those bids are `rejected` + journalled
    // inside the same transaction instead of hanging forever on the drivers'
    // request lists (and instead of feeding the counter endpoint a live-looking
    // offer). `notIn` rather than an allow-list keeps the endpoint's existing
    // contract: the customer owner or the assigned driver may abort any
    // non-terminal order - including a `picked` one, because a trip that breaks
    // down after pickup has no other exit (`/deliver` is the only counterpart
    // and it demands a successful handover).
    const updated = await db.$transaction(async (tx) => {
      const cancelled = await tx.order.updateMany({
        where: { id, status: { notIn: ['delivered', 'cancelled'] } },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      });
      if (cancelled.count === 0) return null;

      const openOffers = await tx.orderOffer.findMany({
        where: { orderId: id, status: 'pending' },
        select: { id: true, price: true },
      });
      if (openOffers.length > 0) {
        await tx.orderOffer.updateMany({
          where: { orderId: id, status: 'pending' },
          data: { status: 'rejected' },
        });
        await tx.offerEvent.createMany({
          data: openOffers.map((o) => ({
            orderId: id,
            offerId: o.id,
            actorId: session.id,
            type: 'rejected',
            price: o.price,
          })),
        });
      }

      return tx.order.findUnique({
        where: { id },
        select: {
          ...publicOrderSelect,
          customer: { select: publicUserSelect },
          driver: { select: publicUserSelect },
        },
      });
    });
    if (!updated) {
      // Lost the race (or the order vanished): the guarded write matched no
      // row, so nothing was cancelled and nothing was journalled.
      return NextResponse.json({ error: 'invalidStatus' }, { status: 409 });
    }
    // C4: realtime status broadcast. Cancellation is the one status change the
    // *customer* can make, so the driver's request list must clear in real
    // time — otherwise a driver could tap Accept on an order that is already
    // gone. Fire-and-forget: the DB row already committed.
    emitOrderStatus(updated);
    // PHASE 6 - the assigned driver is TOLD the order is gone, not just left to
    // notice a missing row. Before this, a cancellation only reached the driver
    // as a silent list refresh (or a realtime event if their screen happened to
    // be open), which is how someone ends up driving to a pickup that no longer
    // exists. Skipped when the driver themself is the caller: nobody needs a
    // notification about their own action.
    if (updated.driverId && updated.driverId !== session.id) {
      const cancelTitle = 'تم إلغاء الطلب';
      const cancelBody = `قام الزبون بإلغاء الطلب ${updated.code}.`;
      void sendPushNotification(updated.driverId, cancelTitle, cancelBody, {
        type: 'order_cancelled',
        orderId: updated.id,
        orderCode: updated.code,
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[orders/cancel] push failed:', e);
      });
      void createNotification({
        userId: updated.driverId,
        type: 'order',
        title: cancelTitle,
        body: cancelBody,
        data: {
          orderId: updated.id,
          code: updated.code,
          i18n: {
            titleKey: 'orderCancelled',
            bodyKey: 'orderCancelledBody',
            params: { code: updated.code },
          },
        },
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[orders/cancel] notification failed:', e);
      });
    }
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
