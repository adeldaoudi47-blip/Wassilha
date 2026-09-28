import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { orderOfferSelect, publicUserSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOfferUpdateToDriver } from '@/lib/pusher-server';

type Ctx = { params: Promise<{ id: string; offerId: string }> };

// PRICE NEGOTIATION (Phase 3) — POST /api/orders/:id/offers/:offerId/reject
// (customer only)
//
// The customer declines one driver's price. Unlike /accept this never
// touches the Order row: the order stays `searching` so the remaining
// drivers' offers stay live and the customer can keep comparing.
//
// SECURITY: the guard is on ownership (the offer's order must belong to the
// calling customer) AND on state (only a `pending` offer can be rejected —
// rejecting an already-accepted offer would not un-assign the order).
// `updateMany` with those preconditions is atomic, so a double-tap or a
// race with /accept can never flip an accepted offer back.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id, offerId } = await params;

    // Resolve the offer first (with its parent order) so we can check
    // ownership and current state before writing anything.
    const offer = await db.orderOffer.findUnique({
      where: { id: offerId },
      select: {
        ...orderOfferSelect,
        driver: { select: publicUserSelect },
        // PHASE 6: the code names the order in the push/notification/event, so
        // the driver does not have to open the app to know which trip it was.
        order: { select: { id: true, code: true, customerId: true } },
      },
    });
    if (!offer) {
      return NextResponse.json({ error: 'offerNotFound' }, { status: 404 });
    }
    // The offer must belong to the order in the URL; a mismatch is a client
    // bug or an attempt to act on another customer's order.
    if (offer.orderId !== id) {
      return NextResponse.json({ error: 'offerNotForOrder' }, { status: 400 });
    }
    if (offer.order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (offer.status !== 'pending') {
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
    }

    // PHASE 6 - one transaction: the guarded decline and its journal row commit
    // together, so the timeline can never miss a rejection the offer row already
    // records. A zero-row update means a concurrent writer settled the bid first
    // (an /accept, typically) - surfaced as the same 409 the pre-check gives.
    const declined = await db.$transaction(async (tx) => {
      const updated = await tx.orderOffer.updateMany({
        where: { id: offer.id, status: 'pending' },
        data: { status: 'rejected' },
      });
      if (updated.count === 0) return false;

      // NEGOTIATION ENGINE (Phase 4): journal the decline.
      await tx.offerEvent.create({
        data: { orderId: offer.orderId, offerId: offer.id, actorId: session.id, type: 'rejected', price: offer.price },
      });
      return true;
    });
    if (!declined) {
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
    }

    // Fire-and-forget: the driver learns their price was declined. Push +
    // in-app row mirror every other negotiation hop, and the write above already
    // committed, so an FCM outage is never fatal to the negotiation.
    const title = 'تم الرد على عرضك';
    const bodyText = `رفض الزبون عرضك ${offer.price} د.ج للطلب ${offer.order.code}.`;
    void sendPushNotification(offer.driverId, title, bodyText, {
      type: 'offer_declined',
      orderId: offer.orderId,
      offerId: offer.id,
      orderCode: offer.order.code,
      price: String(offer.price),
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/reject] push failed:', e);
    });
    void createNotification({
      userId: offer.driverId,
      type: 'order',
      title,
      body: bodyText,
      data: {
        orderId: offer.orderId,
        code: offer.order.code,
        price: offer.price,
        i18n: {
          titleKey: 'offerDeclined',
          bodyKey: 'offerDeclinedBody',
          params: { code: offer.order.code, price: String(offer.price) },
        },
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/reject] notification failed:', e);
    });

    // PHASE 6 - realtime, strictly after the commit:
    //   * the declined driver's own channel, so the bid badge stops saying
    //     "pending" and the row settles without a poll;
    //   * the order channel, so the customer's other tabs converge.
    // The fleet is never a destination: a declined price stays private.
    emitOfferUpdateToDriver(
      {
        kind: 'rejected',
        offerId: offer.id,
        orderId: offer.orderId,
        orderCode: offer.order.code,
        driverId: offer.driverId,
        driverName: offer.driver?.name ?? null,
        price: offer.price,
        status: 'rejected',
        counterPrice: null,
      },
      { alsoOrder: true },
    );

    // Re-read so the response reflects the settled row.
    const settled = await db.orderOffer.findUnique({
      where: { id: offer.id },
      select: { ...orderOfferSelect, driver: { select: publicUserSelect } },
    });
    return NextResponse.json(settled ?? offer);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
