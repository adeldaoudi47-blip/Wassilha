import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, orderOfferSelect, offerEventSelect } from '@/lib/dto';
import { canDriverOfferOnOrder } from '@/lib/offer-policy';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { emitOfferNew, emitOrderStatus } from '@/lib/pusher-server';

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
    // order lookup so a non-driver cannot probe order ids. Phase 4 also
    // pulls the facts the offer gate needs (verification, approval, service
    // type, registered vehicle) in the same query.
    const driver = await db.driver.findUnique({
      where: { userId: session.id },
      select: {
        userId: true,
        isVerified: true,
        applicationStatus: true,
        serviceType: true,
        vehicleRegistration: { select: { vehicleCategory: true, seats: true } },
      },
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
    // Guard the order state before writing the offer. NEGOTIATION ENGINE
    // (Phase 4): every rule (live order, negotiable, not own order, not
    // already assigned, driver verified / approved / right service type /
    // vehicle compatible — including the cargoSize rule) lives in
    // `canDriverOfferOnOrder` so offers can never slip past a check the
    // flat-accept path enforces.
    const order = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        customerId: true,
        price: true,
        status: true,
        driverId: true,
        cargoType: true,
        requiredVehicleType: true,
        requiredSeats: true,
        cargoSize: true,
        isNegotiable: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    const gate = canDriverOfferOnOrder(order, {
      id: session.id,
      isVerified: driver.isVerified,
      applicationStatus: driver.applicationStatus,
      serviceType: driver.serviceType,
      vehicleCategory: driver.vehicleRegistration?.vehicleCategory ?? null,
      seats: driver.vehicleRegistration?.seats ?? null,
    });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.reason }, { status: gate.status });
    }

    // Upsert on the (orderId, driverId) unique pair keeps one live offer
    // per driver per order and refreshes its price.
    //
    // PHASE 5 - THE BID IS CREATED INSIDE A TRANSACTION WITH THE ORDER'S OWN
    // STATE GUARD. `canDriverOfferOnOrder` above is a read: between it and this
    // write the order can be awarded or cancelled, and the upsert would then
    // plant a fresh `pending` bid on a closed order - after the losers' sweep
    // had already run, so nothing would ever close it again. That is exactly
    // how a "live-looking" bid survives forever on a finished order.
    //
    // The guarded `updateMany` below re-asserts "still searching, still
    // unassigned" and takes the ORDER row lock, in this order:
    //   * if an award/cancel committed first, the predicate matches zero rows
    //     after the lock is granted and we bail out with a 409;
    //   * if we win, the order row stays locked until we commit, so the
    //     concurrent award/cancel blocks, then re-reads and sweeps our new bid.
    // Either way no bid can outlive the open window. Lock order is always
    // order-row first, then offer rows (same as the award and cancel routes),
    // so the three writers cannot deadlock.
    //
    // The journal row is written in the same transaction: a price the card
    // shows can no longer be missing from the timeline.
    const offer = await db.$transaction(async (tx) => {
      const stillOpen = await tx.order.updateMany({
        where: { id: order.id, status: 'searching', driverId: null },
        // Idempotent write: the same status value, re-asserted. What matters is
        // the row lock + re-check, i.e. a compare-and-swap with no state change.
        data: { status: 'searching' },
      });
      if (stillOpen.count === 0) return null;

      const row = await tx.orderOffer.upsert({
        where: { orderId_driverId: { orderId: order.id, driverId: session.id } },
        create: {
          orderId: order.id,
          driverId: session.id,
          price,
          status: 'pending',
        },
        update: {
          price,
          status: 'pending',
          // PHASE 5: the driver's new price supersedes the customer's counter.
          // Leaving `counterPrice` behind kept the "customer countered with X"
          // affordance (and the accept-the-counter button) alive on a row the
          // driver had already answered with a fresh price.
          counterPrice: null,
        },
        select: {
          ...orderOfferSelect,
          driver: { select: publicUserSelect },
        },
      });

      // NEGOTIATION ENGINE (Phase 4): journal the event so the customer's
      // timeline shows every price the driver proposed even though the row
      // itself is refreshed in place.
      await tx.offerEvent.create({
        data: { orderId: order.id, offerId: row.id, actorId: session.id, type: 'driver_offer', price },
      });
      return row;
    });
    if (!offer) {
      // The order stopped being claimable between the gate and the write.
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }

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
    // PHASE 6 - the negotiation event itself. `order:status` alone tells the
    // customer's screen that *something* happened and forced a refetch; this
    // carries the bid (price, driver name, status) so the offer list renders it
    // immediately. Emitted AFTER the transaction committed, and only on the
    // ORDER channel: no other driver ever sees a competing price.
    emitOfferNew({
      kind: 'new',
      offerId: offer.id,
      orderId: offer.orderId,
      orderCode: order.code,
      driverId: session.id,
      driverName: offer.driver?.name ?? null,
      price: offer.price,
      status: offer.status,
      counterPrice: offer.counterPrice ?? null,
    });
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
        // NEGOTIATION ENGINE (Phase 4): the full negotiation journal for
        // each offer, oldest first, so both sides can render the price
        // conversation instead of just the last position.
        events: { select: offerEventSelect, orderBy: { createdAt: 'asc' } },
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

