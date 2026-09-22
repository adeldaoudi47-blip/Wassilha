import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { publicOrderSelect } from '@/lib/dto';
import { fanOutNewOrder } from '@/lib/dispatch';

// C3 — Dispatcher for scheduled bookings.
//
// Vercel Cron calls this route every minute. Every order still in
// `status='scheduled'` whose `scheduledAt` is now (or already past) is
// flipped to `searching` and pushed to the eligible drivers — exactly the
// same fan-out POST /api/orders runs for immediate orders.
//
// SECURITY: no user session is involved. The only thing that can call this
// is Vercel's scheduler, which we authenticate with a shared bearer secret.
// Timing-safe compare so the check cannot be bypassed by timing leaks.
export const dynamic = 'force-dynamic';

const CLAIM_BATCH = 50; // orders dispatched per invocation — bounded so a
// large backlog can never exceed the serverless function timeout.

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If the secret is not configured, refuse to run rather than open an
  // unauthenticated dispatch endpoint. This also makes local `next dev`
  // safe: the route 401s instead of silently firing fan-outs.
  if (!secret) return false;

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Step 1 — find the orders whose booking time has arrived and that have
    // not been accepted yet (`driverId` is null). A scheduled order that was
    // pre-accepted stays `scheduled` until pickup; it has a driver already,
    // so it must NOT be re-dispatched.
    const due = await db.order.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: new Date() },
        driverId: null,
      },
      orderBy: { scheduledAt: 'asc' },
      take: CLAIM_BATCH,
      select: publicOrderSelect,
    });

    if (due.length === 0) {
      return NextResponse.json({ processed: 0, notified: 0, skipped: 0 });
    }

    // Step 2 — claim each order atomically, one `updateMany` per order. The
    // `status='scheduled'` precondition is the whole point: only the
    // invocation that actually moves the row sees `count === 1`. If a
    // concurrent cron invocation (or an admin action) already moved an
    // order, we get `count === 0`, skip its fan-out and record it as
    // skipped. That is what makes double pushes impossible when two
    // invocations race on the same tick.
    //
    // NOTE (Prisma 6): `updateManyAndReturnRows` would collapse this into a
    // single query, but it is Preview-only in Prisma 7 and not present in
    // the 6.x client this project ships. The loop below is the same
    // primitive expressed with `updateMany` — one round trip per order,
    // capped by CLAIM_BATCH.
    const claimed: typeof due = [];
    let skipped = 0;
    for (const order of due) {
      const result = await db.order.updateMany({
        where: { id: order.id, status: 'scheduled', driverId: null },
        data: { status: 'searching' },
      });
      if (result.count === 1) {
        claimed.push(order);
      } else {
        skipped += 1;
      }
    }

    // Step 3 — fan out. Fire-and-forget per order: a FCM outage on one order
    // must not block the rest. The order is already `searching` in the DB,
    // so the worst case is a missing push, not a stuck order.
    let notified = 0;
    for (const order of claimed) {
      try {
        const res = await fanOutNewOrder({
          id: order.id,
          code: order.code,
          cargoType: order.cargoType,
          pickup: order.pickup,
          dropoff: order.dropoff,
        });
        notified += res.notified;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cron/dispatch-scheduled] fan-out failed for', order.id, e);
      }
    }

    // eslint-disable-next-line no-console
    console.info(
      `[cron/dispatch-scheduled] due=${due.length} claimed=${claimed.length} notified=${notified}`,
    );

    return NextResponse.json({
      processed: claimed.length,
      notified,
      skipped,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron/dispatch-scheduled] failed:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
