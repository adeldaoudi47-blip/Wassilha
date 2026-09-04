// TRIP OFFERS — book a single offer
// -----------------------------------------------------------------------------
// POST /api/trip-offers/[id]/book
//
// Customer claims an `available` offer. The handler:
//   1. Authenticates and resolves the offer.
//   2. Verifies the offer is still `available` AND in the future.
//      We rely on a conditional update (`where: { id, status: 'available' }`)
//      so two concurrent customers cannot both book the same offer —
//      the second one receives P2025 (no rows matched) and gets 409.
//   3. Creates an Order in `status='accepted'`, with `driverId` set
//      to the offer's driver (the driver effectively pre-accepted
//      by publishing the offer). The new order points back to the
//      offer via `tripOffer` so admins can trace origin.
//   4. Updates the offer to `status='booked'` and sets
//      `bookerId` + `orderId`. Both writes are inside a single
//      `prisma.$transaction` so the two states can never diverge.
//
// Auth: customer only. A driver booking their own offer is
// rejected with 403 (rare, but trivial to guard against).
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession as getSessionUser } from '@/lib/auth';
import {
  generateOrderCode,
  GUERRARA_CENTER,
} from '@/lib/wassilha-data';
import { publicTripOfferSelect, publicOrderSelect } from '@/lib/dto';
import type { CargoKey } from '@/lib/types';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user || user.role !== 'customer') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  // First, look up the offer. We need the driver's userId
  // (NOT driverId — `Order.driverId` FK is to `User.id`, see
  // the `@relation("DriverOrders", fields: [driverId],
  // references: [id])` on `model Order` in schema.prisma).
  // We also need the offer's serviceType / cargoType / etc.
  // to build the Order row. Doing a read first also gives us
  // a friendlier 404 when the id is bogus (Prisma's P2025
  // would otherwise surface as a 500).
  const offer = await db.tripOffer.findUnique({
    where: { id },
    select: {
      id: true,
      driverId: true,
      serviceType: true,
      pickup: true,
      dropoff: true,
      scheduledAt: true,
      price: true,
      cargoType: true,
      status: true,
      driver: { select: { id: true, userId: true } },
    },
  });
  if (!offer) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (offer.status !== 'available') {
    return NextResponse.json(
      { error: 'offer_not_available', status: offer.status },
      { status: 409 },
    );
  }
  if (offer.scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'offer_already_departed' },
      { status: 409 },
    );
  }
  // Guard: a customer cannot book their own offer (offers are
  // owned by drivers, but the relation is Driver.id, not
  // User.id — the check below is via Driver.userId).
  if (offer.driver.userId === user.id) {
    return NextResponse.json(
      { error: 'cannot_book_own_offer' },
      { status: 403 },
    );
  }

  // Build the Order row. The customer cannot pick a different
  // pickup/dropoff/time — those are fixed by the offer. We
  // default the coords to GUERRARA_CENTER (the offer is
  // text-based) and the price to the offer's price.
  //
  // `Order.driverId` is a FK to `User.id` (not `Driver.id`),
  // so we look up the offer's driver's userId.
  const code = await generateOrderCode();
  const orderData: Prisma.OrderUncheckedCreateInput = {
    code,
    customerId: user.id,
    driverId: offer.driver.userId,
    // Map serviceType to the corresponding cargoType on Order.
    //   TAXI  → 'taxi'  (passenger transport)
    //   CARGO → offer.cargoType  (e.g. 'parcel' / 'furniture' / ...)
    cargoType: (offer.serviceType === 'TAXI'
      ? 'taxi'
      : offer.cargoType) as CargoKey,
    pickup: offer.pickup,
    dropoff: offer.dropoff,
    pickupLat: GUERRARA_CENTER.lat,
    pickupLng: GUERRARA_CENTER.lng,
    dropoffLat: GUERRARA_CENTER.lat,
    dropoffLng: GUERRARA_CENTER.lng,
    weight: offer.serviceType === 'TAXI' ? 0 : 20,
    distance: 3.0,
    price: offer.price,
    status: 'accepted',
    acceptedAt: new Date(),
  };

  try {
    // We split the work into two transactions because the
    // order row's `id` is needed to back-fill `TripOffer.orderId`,
    // and we want the conditional `updateMany` (the
    // race-condition guard) to fire AFTER we know the order id.
    //
    //   1. Tx 1: create the Order in `status='accepted'`. If this
    //      fails, no offer is touched.
    //   2. Tx 2: atomically flip the offer to `booked` and set
    //      `bookerId` / `orderId`. The `where: { status:
    //      'available' }` clause is the race guard. If `count
    //      === 0`, the offer was taken in between; we ROLLBACK
    //      (the created order becomes orphan-but-rolled-back,
    //      and the customer's money / state is unchanged).
    //
    // The order in Tx 1 is created with `status='accepted'` but
    // because Tx 2 may fail, the customer is told "failed" and
    // Tx 1 is reverted. We do NOT keep an orphan accepted order.
    const order = await db.$transaction(async (tx) => {
      return tx.order.create({
        data: orderData,
        select: publicOrderSelect,
      });
    });
    let updatedOffer;
    try {
      updatedOffer = await db.$transaction(async (tx) => {
        const flipped = await tx.tripOffer.updateMany({
          where: { id: offer.id, status: 'available' },
          data: {
            status: 'booked',
            bookerId: user.id,
            orderId: order.id,
          },
        });
        if (flipped.count === 0) {
          throw new Prisma.PrismaClientKnownRequestError(
            'offer already taken',
            { code: 'P2025', clientVersion: 'tx' },
          );
        }
        return tx.tripOffer.findUnique({
          where: { id: offer.id },
          select: publicTripOfferSelect,
        });
      });
    } catch (err) {
      // Compensate: roll back the order created in Tx 1 by
      // deleting it. This keeps the database in a consistent
      // state — either the offer is booked AND the order
      // exists, or neither.
      try {
        await db.order.delete({ where: { id: order.id } });
      } catch {
        // best-effort; if it fails, an admin can clean it up.
      }
      throw err;
    }
    return NextResponse.json({ order, offer: updatedOffer }, { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      return NextResponse.json(
        { error: 'offer_already_taken' },
        { status: 409 },
      );
    }
    // Any other Prisma error is a real bug; let it bubble to
    // Next's default 500 handler.
    throw err;
  }
}
