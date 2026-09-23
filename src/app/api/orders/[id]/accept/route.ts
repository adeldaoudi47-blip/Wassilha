import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushNotification } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
import { emitOrderStatus } from '@/lib/pusher-server';

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
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 403 });
    }

    const { id } = await params;
    const claim = await db.order.updateMany({
      where: { id, status: 'searching', driverId: null },
      data: {
        driverId: session.id,
        status: 'accepted',
        acceptedAt: new Date(),
      },
    });
    if (claim.count === 0) {
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