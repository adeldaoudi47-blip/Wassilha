import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  orderOfferSelect,
  publicUserSelect,
  publicOrderSelect,
} from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOfferUpdateToDriver, emitOrderStatus } from '@/lib/pusher-server';

type Ctx = { params: Promise<{ id: string; offerId: string }> };

// PRICE NEGOTIATION (Phase 3) — POST /api/orders/:id/offers/:offerId/counter
// (customer only)
//
// The customer replies to a driver's price with a price of their own. The
// offer flips to `countered` and the proposed amount is stored on
// `counterPrice`; the driver then decides to accept it (they re-send an
// offer at that price, or the customer accepts the driver's price) or to
// walk away. The negotiation keeps going as long as the order is still
// `searching`.
//
// SECURITY: ownership is enforced by the WHERE clause shape (the offer's
// order must belong to the calling customer) and the state guard (only a
// `pending` offer can be countered). The atomic `updateMany` with those
// preconditions means a double-tap or a race with /accept can never reopen
// an already-settled negotiation.
//
// Same validation range as the driver's offer: the fare table tops out in
// the low thousands, so anything outside this window is a client bug.
const counterSchema = z.object({
  price: z
    .number({ message: 'invalidPrice' })
    .int('invalidPrice')
    .min(50, 'invalidPrice')
    .max(100_000, 'invalidPrice'),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = counterSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? 'invalidBody', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { price } = parsed.data;

    const { id, offerId } = await params;

    // Resolve the offer with its parent order so ownership and state can be
    // checked before any write. The driver's identity and the order code are
    // joined here in one roundtrip — both feed the notification below.
    const offer = await db.orderOffer.findUnique({
      where: { id: offerId },
      select: {
        ...orderOfferSelect,
        driver: { select: publicUserSelect },
        order: {
          select: {
            id: true,
            code: true,
            customerId: true,
            status: true,
            // PHASE 5: a counter is only meaningful while the order is still up
            // for grabs, so the guard below needs the assignment as well.
            driverId: true,
            isNegotiable: true,
          },
        },
      },
    });
    if (!offer) {
      return NextResponse.json({ error: 'offerNotFound' }, { status: 404 });
    }
    // The offer must belong to the order in the URL — a mismatched pair is
    // either a client bug or an attempt to counter an offer on another order.
    if (offer.orderId !== id) {
      return NextResponse.json({ error: 'offerNotForOrder' }, { status: 400 });
    }
    if (offer.order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (offer.status !== 'pending') {
      // Idempotency guard: only a live pending offer can be countered.
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
    }
    if (offer.order.status !== 'searching' || offer.order.driverId !== null) {
      // PHASE 5: the ORDER must still be open, not just the offer row. A
      // counter on a bid that belongs to an already-awarded (or cancelled)
      // order used to succeed and pushed a "customer countered" alert to a
      // driver who could no longer win. The decision is re-made inside the
      // transaction below; this early exit gives the common stale-screen tap
      // its specific error.
      return NextResponse.json({ error: 'orderNotSearchable' }, { status: 409 });
    }

    // PHASE 5 - TRANSACTIONAL COUNTER.
    //
    // Two guarantees now hold together instead of one:
    //   1. The offer update keeps Phase 3's `status: 'pending'` precondition,
    //      so a race with an /accept of the same bid can never have both sides
    //      win - the first writer flips the status, the second matches zero
    //      rows (surfaced as the 409 below).
    //   2. The ORDER is re-read inside the same transaction, so a bid on an
    //      order that has since been awarded or cancelled is refused before the
    //      counter is recorded and before a notification is sent about it.
    //
    // Guarantee 1 is what makes this airtight rather than merely narrower:
    // every path that closes the negotiation window (offer award, flat accept,
    // cancel) now rejects the order's pending bids in ITS OWN transaction, so
    // "this offer is still pending" and "this order is still open" can no
    // longer disagree.
    //
    // The journal write moved inside the transaction with them: a counter that
    // is visible on the offer card can no longer be missing from the timeline.
    const outcome = await db.$transaction(async (tx) => {
      const live = await tx.order.findUnique({
        where: { id: offer.orderId },
        select: { status: true, driverId: true },
      });
      if (!live || live.status !== 'searching' || live.driverId !== null) {
        return 'orderNotSearchable' as const;
      }
      const updated = await tx.orderOffer.updateMany({
        where: { id: offer.id, status: 'pending' },
        data: { status: 'countered', counterPrice: price },
      });
      if (updated.count === 0) return 'offerNotPending' as const;

      // NEGOTIATION ENGINE (Phase 4): journal the customer's counter so the
      // timeline keeps every price of the conversation.
      await tx.offerEvent.create({
        data: { orderId: offer.orderId, offerId: offer.id, actorId: session.id, type: 'customer_counter', price },
      });
      return 'ok' as const;
    });
    if (outcome !== 'ok') {
      return NextResponse.json({ error: outcome }, { status: 409 });
    }

    // Re-read so the response carries the settled row (counterPrice set +
    // the driver's public identity for the customer's card).
    const settled = await db.orderOffer.findUnique({
      where: { id: offer.id },
      select: { ...orderOfferSelect, driver: { select: publicUserSelect } },
    });

    // Fire-and-forget: tell the driver the customer proposed a different
    // price. Same reliability contract as the accept route (push + in-app
    // row): the DB write above already committed, so a notification failure
    // is never fatal to the negotiation itself.
    const title = 'عرض سعر مضاد';
    const bodyText = `الزبون يقترح ${price} د.ج بدل عرضك ${offer.price} د.ج للطلب ${offer.order.code}.`;
    void sendPushNotification(offer.driverId, title, bodyText, {
      type: 'offer_countered',
      orderId: offer.orderId,
      offerId: offer.id,
      orderCode: offer.order.code,
      // FCM data payloads are strings; the client parses it back when it
      // renders the "customer countered" banner.
      price: String(price),
      originalPrice: String(offer.price),
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/counter] push failed:', e);
    });
    void createNotification({
      userId: offer.driverId,
      type: 'order',
      title,
      body: bodyText,
      data: {
        orderId: offer.orderId,
        code: offer.order.code,
        price,
        i18n: {
          titleKey: 'offerCountered',
          bodyKey: 'offerCounteredBody',
          params: {
            code: offer.order.code,
            price: String(price),
            originalPrice: String(offer.price),
          },
        },
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/counter] notification failed:', e);
    });

    // Realtime: the driver's request list subscribes to order events, so the
    // card flips to "the customer countered with X" without a poll. The
    // emitter needs the full order row to bind the customer/driver channels.
    const fresh = await db.order.findUnique({
      where: { id: offer.orderId },
      select: { ...publicOrderSelect },
    });
    if (fresh) emitOrderStatus(fresh);
    // PHASE 6 - the negotiation event: the driver who owns the bid learns the
    // new price instantly on their OWN channel, and the order channel mirrors
    // it so the customer's other tabs converge. No other driver is a
    // destination, so a competing price never leaves this negotiation.
    emitOfferUpdateToDriver(
      {
        kind: 'countered',
        offerId: offer.id,
        orderId: offer.orderId,
        orderCode: offer.order.code,
        driverId: offer.driverId,
        driverName: offer.driver?.name ?? null,
        price: offer.price,
        status: 'countered',
        counterPrice: price,
      },
      { alsoOrder: true },
    );

    return NextResponse.json(settled ?? offer);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
