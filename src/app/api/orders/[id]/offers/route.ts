import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, orderOfferSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOrderStatus } from '@/lib/pusher-server';

type Ctx = { params: Promise<{ id: string }> };

// PRICE NEGOTIATION (Phase 3) — POST /api/orders/:id/offers  (driver only)
//
// The driver sends a counter-price on a negotiable order. The offer is an
// upsert (see below) so that:
//   - the driver only ever has ONE live offer per order (an existing
//     pending offer from the same driver is replaced with the newest
//     price, the customer never sees stale duplicate rows),
//   - any OTHER driver's pending offers on the same order are left intact
//     so the customer can compare several drivers' prices.
//
// SECURITY: `driverId` is always taken from the session, never from the
// body. `price` is validated by Zod and clamped to a sane positive range.
const createOfferSchema = z.object({
  price: z
    .number({ message: 'invalidPrice' })
    .int('invalidPrice')
    // Positive, bounded range: the fare table tops out in the low
    // thousands, so a six-figure price is a client bug, not a negotiation.
    .min(50, 'invalidPrice')
    .max(100_000, 'invalidPrice'),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // The driver must have an active Driver profile — checked before any
    // order lookup so a non-driver cannot probe order ids.
    const driver = await db.driver.findUnique({
      where: { userId: session.id },
    });
    if (!driver) {
      return NextResponse.json(
        { error: 'noDriverProfile' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = createOfferSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? 'invalidBody', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { price } = parsed.data;

    const { id } = await params;
    // Guard the order state before writing the offer. The customer's
    // negotiability flag is part of the guard: a fixed-price order never
    // receives offers, and an already-accepted order cannot be bid on.
    const order = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        customerId: true,
        price: true,
        status: true,
        isNegotiable: true,
        driverId: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (order.status !== 'searching') {
      return NextResponse.json({ error: 'orderNotSearchable' }, { status: 409 });
    }
    if (!order.isNegotiable) {
      return NextResponse.json({ error: 'orderNotNegotiable' }, { status: 403 });
    }
    // The customer cannot bid their own order's price down, and a driver
    // who already claimed the order has no reason to re-offer.
    if (order.customerId === session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (order.driverId === session.id) {
      return NextResponse.json({ error: 'alreadyAssigned' }, { status: 409 });
    }

    // Upsert on the (orderId, driverId) unique pair keeps one live offer
    // per driver per order and refreshes its price.
    const offer = await db.orderOffer.upsert({
      where: { orderId_driverId: { orderId: order.id, driverId: session.id } },
      create: {
        orderId: order.id,
        driverId: session.id,
        price,
        status: 'pending',
      },
      update: { price, status: 'pending' },
      select: {
        ...orderOfferSelect,
        driver: { select: publicUserSelect },
      },
    });

    // Fire-and-forget: tell the customer a driver proposed a price. Push +
    // in-app row mirror the accept flow's reliability contract; the DB
    // write above already committed, so a FCM outage is never fatal.
    const title = 'عرض سعر جديد';
    const bodyText = `السائق يقترح ${price} د.ج لطلبك ${order.code}.`;
    void sendPushNotification(order.customerId, title, bodyText, {
      type: 'order_offer',
      orderId: order.id,
      offerId: offer.id,
      orderCode: order.code,
      // FCM data payloads are strings; the client parses it back to a
      // number when it renders the offer badge.
      price: String(price),
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers] push failed:', e);
    });
    void createNotification({
      userId: order.customerId,
      type: 'order',
      title,
      body: bodyText,
      data: {
        orderId: order.id,
        code: order.code,
        price,
        i18n: {
          titleKey: 'newOffer',
          bodyKey: 'newOfferBody',
          params: { code: order.code, price: String(price) },
        },
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/offers] notification failed:', e);
    });

    // Realtime: the customer's tracking screen subscribes to order events,
    // so a new offer appears instantly without a poll.
    emitOrderStatus(order);
    return NextResponse.json(offer, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// GET /api/orders/:id/offers  (customer: all offers on their order;
// driver: only their own offers on this order)
//
// The customer sees every driver's price so they can pick; a driver only
// ever sees their own offer so they cannot read the competition's prices.
// Ownership/scoping is enforced by the WHERE clause itself, not a separate
// lookup, so a customer can never read another customer's offer list and a
// driver can never read another driver's prices.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer' && session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const where =
      session.role === 'customer'
        ? { orderId: id, order: { customerId: session.id } }
        : { orderId: id, driverId: session.id };

    const offers = await db.orderOffer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        ...orderOfferSelect,
        // The customer needs the driver's identity to choose; the driver
        // already knows it, but joining keeps one response shape.
        driver: { select: publicUserSelect },
      },
    });

    return NextResponse.json(offers);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

