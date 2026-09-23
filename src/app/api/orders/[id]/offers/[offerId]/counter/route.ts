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
import { emitOrderStatus } from '@/lib/pusher-server';

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

    // The counter is atomic with the status precondition, so a race with an
    // /accept of the same offer can never both win: the first writer flips
    // the status away from "pending" and the second call matches zero rows
    // (surfaced as the 409 below).
    const updated = await db.orderOffer.updateMany({
      where: { id: offer.id, status: 'pending' },
      data: { status: 'countered', counterPrice: price },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
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

    return NextResponse.json(settled ?? offer);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
