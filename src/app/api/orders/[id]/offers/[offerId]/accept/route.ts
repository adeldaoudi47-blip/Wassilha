import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  publicUserSelect,
  publicOrderSelect,
  orderOfferSelect,
} from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOrderStatus } from '@/lib/pusher-server';

type Ctx = { params: Promise<{ id: string; offerId: string }> };

// PRICE NEGOTIATION (Phase 3) — POST /api/orders/:id/offers/:offerId/accept
// (customer only)
//
// The customer accepts one driver's negotiated price. This is the
// negotiation counterpart of /accept: it atomically claims the order for
// that driver AND stamps the agreed price onto `finalPrice`.
//
// SECURITY: the claim is a guarded `updateMany` (not findUnique + update),
// so two customers / two offers can never both win the same order. The
// guards are: the order is still `searching` and unassigned, it belongs to
// the calling customer, and the offer is `pending` on this order. Only a
// row matching ALL of them is updated; anything else is a 409.
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

    // Load the offer + its order so the response and the notification below
    // have the driver's identity and the negotiated price.
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
    // either a client bug or an attempt to accept an offer on another order.
    if (offer.orderId !== id) {
      return NextResponse.json({ error: 'offerNotForOrder' }, { status: 400 });
    }
    if (offer.order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (offer.status !== 'pending') {
      // Idempotency guard: a double-tap on a stale card cannot re-assign
      // an order whose offer was already settled.
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
    }

    // Atomic claim: flip the order to accepted + stamp the agreed price.
    // The status/driverId precondition makes this safe against a race with
    // the flat /accept route or a second offer acceptance.
    const claim = await db.order.updateMany({
      where: {
        id: offer.orderId,
        customerId: session.id,
        status: 'searching',
        driverId: null,
      },
      data: {
        driverId: offer.driverId,
        status: 'accepted',
        acceptedAt: new Date(),
        finalPrice: offer.price,
      },
    });
    if (claim.count === 0) {
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }

    // Settle the offer rows: the winner is `accepted`, every other pending
    // offer on this order is `rejected` so the losing drivers get a clear
    // final state instead of a hung "pending".
    await db.orderOffer.update({
      where: { id: offer.id },
      data: { status: 'accepted' },
    });
    await db.orderOffer.updateMany({
      where: {
        orderId: offer.orderId,
        status: 'pending',
        id: { not: offer.id },
      },
      data: { status: 'rejected' },
    });

    const updated = await db.order.findUnique({
      where: { id: offer.orderId },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
    });
    if (!updated) {
      // Race: order deleted between the claim and the read.
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    // Fire-and-forget: tell the driver their price was accepted. Same
    // reliability contract as the accept route (push + in-app row): the DB
    // write already committed, so a notification failure is never fatal.
    const title = 'تم قبول سعرك';
    const bodyText = `قبل الزبون عرضك ${offer.price} د.ج للطلب ${updated.code}.`;
    void sendPushNotification(offer.driverId, title, bodyText, {
      type: 'order_accepted',
      orderId: updated.id,
      orderCode: updated.code,
      // FCM data payloads are strings; the client parses it back when it
      // renders the "your price was accepted" banner.
      price: String(offer.price),
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/accept] push failed:', e);
    });
    void createNotification({
      userId: offer.driverId,
      type: 'order',
      title,
      body: bodyText,
      data: {
        orderId: updated.id,
        code: updated.code,
        price: offer.price,
        i18n: {
          titleKey: 'offerAccepted',
          bodyKey: 'offerAcceptedBody',
          params: { code: updated.code, price: String(offer.price) },
        },
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers/accept] notification failed:', e);
    });

    // Realtime: the driver's list and the customer's tracking screen both
    // subscribe to order status, so this flips both UIs in one event.
    emitOrderStatus(updated);
    return NextResponse.json({ order: updated, offer });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
