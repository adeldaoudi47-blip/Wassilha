import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { emitOrderStatus } from '@/lib/pusher-server';
import { isVehicleCompatible, serviceCategoryFor } from '@/lib/dispatch';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/accept  (driver only)
//
// SECURITY: only the public subset of `User` fields is returned (no
// `passwordHash`, `email`, `phoneVerified`, or `accountStatus`).
//
// SECURITY (V4): the claim is a single atomic `updateMany` with a
// status + driverId guard. Two drivers calling /accept at the same
// instant can never both succeed: the DB row matches the WHERE clause
// exactly once. The previous findUnique+update pattern allowed both
// requests to pass the status check before the second update clobbered
// the first driver's assignment (and the second one still received a
// 200 response with a stale body).
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Ensure the logged-in driver actually has a Driver profile.
    // SECURITY: checked BEFORE the atomic update so a non-driver cannot
    // probe whether an order id exists by racing the notFound vs
    // notAvailable branches.
    const driver = await db.driver.findUnique({
      where: { userId: session.id },
      // PHASE 1: the compatibility gate below needs the driver's registered
      // vehicle, not just the fact that a Driver row exists.
      select: {
        id: true,
        // PHASE 5: the eligibility half of the bid policy is enforced on this
        // path too (see the account-state gate right below).
        isVerified: true,
        applicationStatus: true,
        serviceType: true,
        vehicleRegistration: { select: { vehicleCategory: true, seats: true } },
      },
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 403 });
    }
    // PHASE 5 - ACCOUNT-STATE GATE.
    //
    // The dispatch fan-out only ever *shows* orders to verified, approved
    // drivers, but the flat accept had no check of its own: a driver whose
    // application was rejected or suspended - but who still holds an order id
    // from a stale list, or who is simply probing - could claim the job, and
    // the customer would get a push naming a driver who may not serve them.
    // This is the same precondition `canDriverOfferOnOrder` enforces on the
    // negotiation path, applied to the direct-claim path. It is deliberately
    // checked BEFORE the order is loaded so an unauthorised caller still cannot
    // probe whether an order id exists.
    if (!driver.isVerified || driver.applicationStatus !== 'active') {
      return NextResponse.json({ error: 'driverNotEligible' }, { status: 403 });
    }

    const { id } = await params;

    // PHASE 1 - VEHICLE COMPATIBILITY GATE (security + business rule).
    //
    // The dispatch fan-out and the driver's incoming feed already hide orders
    // a vehicle cannot serve, but hiding is never the security: a driver could
    // still POST here directly (or hold a stale list) and claim a furniture job
    // with a motorbike, or a 7-passenger ride with a 5-seater. This re-checks
    // the same isVehicleCompatible policy server-side, before the atomic claim.
    const order = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        driverId: true,
        cargoType: true,
        requiredVehicleType: true,
        requiredSeats: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (order.status !== 'searching' || order.driverId !== null) {
      // Same 409 the atomic claim below would produce, surfaced earlier.
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }
    if (!isVehicleCompatible(order, driver.vehicleRegistration)) {
      // Telemetry: a rejected claim is either a stale client list or a
      // deliberate probe, and both are worth seeing in the logs.
      // eslint-disable-next-line no-console
      console.warn(
        '[orders/accept] vehicle mismatch',
        JSON.stringify({
          orderId: order.id,
          driverId: session.id,
          cargoType: order.cargoType,
          requiredVehicleType: order.requiredVehicleType,
          requiredSeats: order.requiredSeats,
        }),
      );
      return NextResponse.json({ error: 'vehicleNotCompatible' }, { status: 403 });
    }
    // PHASE 5 - SERVICE-TYPE GATE. `serviceCategoryFor` is the same policy the
    // dispatch feed, the offer gate and the offer-award route use, so "who may
    // serve this order" has exactly one answer everywhere. A TAXI-only driver
    // never claims a cargo job, however compatible the vehicle.
    const requiredService = serviceCategoryFor(order.cargoType);
    if (driver.serviceType !== 'BOTH' && driver.serviceType !== requiredService) {
      return NextResponse.json({ error: 'serviceTypeMismatch' }, { status: 403 });
    }

    // PHASE 5 - ATOMIC CLAIM + NEGOTIATION SETTLEMENT.
    //
    // The claim itself is unchanged (V4's conditional `updateMany`), but it now
    // shares one transaction with the cleanup of the live bids on this order.
    // Phase 3 shipped negotiation without wiring it into the flat accept: a
    // driver could win by tapping Accept while every competing bid stayed
    // `pending` forever - the losing drivers kept a card that looked
    // actionable and the timeline never recorded why. The same sweep the
    // offer-award route performs (reject + journal) runs here, atomically with
    // the assignment, so both entry points into `accepted` leave identical
    // state behind.
    const claimed = await db.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id, status: 'searching', driverId: null },
        data: {
          driverId: session.id,
          status: 'accepted',
          acceptedAt: new Date(),
        },
      });
      if (claim.count === 0) return false;

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
      return true;
    });
    if (!claimed) {
      return NextResponse.json({ error: 'notAvailable' }, { status: 409 });
    }

    const updated = await db.order.findUnique({
      where: { id },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
    });
    if (!updated) {
      // Race: order was deleted between the update and the read.
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    // Fire-and-forget: tell the customer their order was accepted.
    // CUSTOM MESSAGE (Phase 4): the body names the driver, so the customer
    // knows who is coming before they even open the app.
    const driverName = updated.driver?.name ?? '';
    const title = 'تم قبول طلبك';
    const bodyText = driverName
      ? `السائق ${driverName} في طريقه إليك الآن.`
      : 'السائق في طريقه إليك الآن.';
    void sendPushNotification(
      updated.customerId,
      title,
      bodyText,
      { type: 'order_accepted', orderId: updated.id, orderCode: updated.code }
    ).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/accept] push failed:', e);
    });
    // In-app notification center row (fire-and-forget, same reliability
    // contract as the push above): the customer still sees "order accepted"
    // in their bell even when FCM is unavailable or the user opted out of
    // push. `data.i18n` lets the center re-render this in French.
    void createNotification({
      userId: updated.customerId,
      type: 'order',
      title,
      body: bodyText,
      data: {
        orderId: updated.id,
        code: updated.code,
        // The named body is used when the driver's name is known; the center
        // falls back to `driverOnTheWay` when `params.driver` is absent.
        i18n: {
          titleKey: 'orderAccepted',
          bodyKey: driverName ? 'driverOnTheWayNamed' : 'driverOnTheWay',
          ...(driverName ? { params: { driver: driverName } } : {}),
        },
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[orders/accept] notification failed:', e);
    });
    // C4: realtime status broadcast. Under socket.io this came from the
    // driver's client emitting `order:status` after the 200 response; moving
    // it server-side means the customer's tracking screen updates even if the
    // driver's socket was never connected. Fire-and-forget like the two
    // side-effects above: the DB write already committed.
    emitOrderStatus(updated);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}