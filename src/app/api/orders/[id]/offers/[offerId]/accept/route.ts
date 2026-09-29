import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  publicUserSelect,
  publicOrderSelect,
  orderOfferSelect,
} from '@/lib/dto';
import { isVehicleCompatible, serviceCategoryFor } from '@/lib/dispatch';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import {
  emitOfferSettledToLosers,
  emitOfferUpdateToDriver,
  emitOrderStatus,
} from '@/lib/pusher-server';

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
            // NEGOTIATION ENGINE (Phase 4): the vehicle-match facts needed
            // to re-verify the offering driver before claiming (below).
            cargoType: true,
            requiredVehicleType: true,
            requiredSeats: true,
            cargoSize: true,
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

    // NEGOTIATION ENGINE (Phase 4): re-verify the offering driver's vehicle
    // against the order before claiming. Offers created BEFORE the gate
    // existed could be vehicle-incompatible; accepting one would hand a
    // large shipment to a motorbike. Rejecting here (409) keeps the order
    // `searching` so the customer can pick another offer instead.
    const offeringDriver = await db.driver.findUnique({
      where: { userId: offer.driverId },
      select: {
        isVerified: true,
        applicationStatus: true,
        // PHASE 5: the service-type half of the bid policy is re-checked at
        // award time too - the offer row is never the only proof of
        // eligibility.
        serviceType: true,
        vehicleRegistration: { select: { vehicleCategory: true, seats: true } },
      },
    });
    if (!offeringDriver || !offeringDriver.isVerified || offeringDriver.applicationStatus !== 'active') {
      return NextResponse.json({ error: 'driverNotEligible' }, { status: 409 });
    }
    // SERVICE-TYPE GATE (Phase 5): `serviceCategoryFor` is the same helper the
    // dispatch fan-out and `canDriverOfferOnOrder` use, so "who may serve this
    // order" has exactly one answer across the feed, the bid and the award. A
    // driver who was switched to TAXI-only (or dropped to `pending`) between
    // bidding and award is no longer eligible, whatever their old offer says.
    const requiredService = serviceCategoryFor(offer.order.cargoType);
    if (offeringDriver.serviceType !== requiredService) {
      return NextResponse.json({ error: 'serviceTypeMismatch' }, { status: 409 });
    }
    if (
      !isVehicleCompatible(
        {
          cargoType: offer.order.cargoType,
          requiredVehicleType: offer.order.requiredVehicleType,
          requiredSeats: offer.order.requiredSeats,
          cargoSize: offer.order.cargoSize,
        },
        offeringDriver.vehicleRegistration,
      )
    ) {
      return NextResponse.json({ error: 'vehicleNotCompatible' }, { status: 409 });
    }

    // PHASE 5 - ATOMIC AWARD.
    //
    // Phase 3/4 made the claim itself atomic, but the settlement around it was
    // not: the claim, the winner update, the loser sweep and the journal were
    // four independent writes. A failure in the middle (timeout, cold-start
    // kill, DB blip) could commit the order as `accepted` while every
    // competing offer stayed `pending` forever - drivers holding a live-looking
    // bid on an order that was already gone, and a timeline that never ends.
    // All of it now shares ONE transaction: either the whole award lands or
    // nothing does.
    //
    // The preconditions are what make the race safe. `updateMany` still
    // matches only an order that is `searching`, unassigned and owned by the
    // caller, so a second acceptance - of this offer, of a competing one, or
    // from the flat /accept route - matches zero rows and the transaction
    // aborts before it can touch an offer row.
    const awarded = await db.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
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
      if (claim.count === 0) return null;

      // Settle the offer rows: the winner is `accepted`, every other pending
      // offer on this order is `rejected` so the losing drivers get a clear
      // final state instead of a hung "pending".
      const losers = await tx.orderOffer.findMany({
        where: {
          orderId: offer.orderId,
          status: 'pending',
          id: { not: offer.id },
        },
        select: { id: true, driverId: true, price: true },
      });
      const winner = await tx.orderOffer.updateMany({
        where: { id: offer.id, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (winner.count === 0) {
        // Belt and braces: the order row was claimed but this offer is no
        // longer `pending` (a concurrent writer settled it). Bail out - the
        // rollback undoes the claim too, so the order never ends up assigned
        // on the strength of a stale bid.
        return null;
      }
      await tx.orderOffer.updateMany({
        where: {
          orderId: offer.orderId,
          status: 'pending',
          id: { not: offer.id },
        },
        data: { status: 'rejected' },
      });

      // NEGOTIATION ENGINE (Phase 4): journal the settlement (accepted +
      // every auto-rejected alternative) so the timeline ends visibly.
      // PHASE 5: written INSIDE the transaction, so the journal is exactly as
      // durable as the award it describes - the two can no longer disagree.
      await tx.offerEvent.createMany({
        data: [
          { orderId: offer.orderId, offerId: offer.id, actorId: session.id, type: 'accepted', price: offer.price },
          ...losers.map((l) => ({
            orderId: offer.orderId,
            offerId: l.id,
            actorId: session.id,
            type: 'rejected',
            price: l.price,
          })),
        ],
      });
      // PHASE 6: the rejected bids are handed back so the caller can tell each
      // losing driver, AFTER the commit, on their own channel.
      return losers;
    });
    if (!awarded) {
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }

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
    // PHASE 6 - the negotiation half of the award, emitted only AFTER the
    // transaction above committed:
    //   * the WINNER learns on their own channel (and the order channel, so the
    //     customer's other tabs flip the card too);
    //   * every LOSER gets one `rejected` on their own channel, so a dead bid
    //     stops looking actionable without waiting for their next poll.
    // Neither destination is a fan-out list: no driver ever sees another
    // driver's negotiation.
    emitOfferUpdateToDriver(
      {
        kind: 'accepted',
        offerId: offer.id,
        orderId: updated.id,
        orderCode: updated.code,
        driverId: offer.driverId,
        driverName: offer.driver?.name ?? null,
        price: offer.price,
        status: 'accepted',
        counterPrice: null,
      },
      { alsoOrder: true },
    );
    emitOfferSettledToLosers(awarded, { id: updated.id, code: updated.code });
    // Re-read the winner so the response carries the SETTLED row (`accepted`)
    // instead of the `pending` snapshot taken before the award. The customer's
    // offer list renders straight from this payload, so a stale status would
    // leave Accept/Decline buttons on a negotiation that is already over.
    const settledOffer =
      (await db.orderOffer.findUnique({
        where: { id: offer.id },
        select: { ...orderOfferSelect, driver: { select: publicUserSelect } },
      })) ?? offer;
    return NextResponse.json({ order: updated, offer: settledOffer });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
