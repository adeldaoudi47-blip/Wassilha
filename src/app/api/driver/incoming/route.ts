import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

// GET /api/driver/incoming  — orders with status='searching' OR
// status='scheduled' that are available to online drivers.
//
// The `scheduled` bucket covers future-dated bookings (see
// scheduled bookings feature). Drivers can pre-accept them so the
// order is locked in for the requested time. The dispatcher (or a
// cron-like job, out of scope here) flips `scheduled` orders to
// `searching` when their `scheduledAt` arrives, at which point
// other drivers can also pick them up if the original driver
// cancels.
//
// SECURITY: only the public subset of `User` fields is returned. Drivers
// MUST NEVER see customer `passwordHash`, `email`, or `phoneVerified`.
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const orders = await db.order.findMany({
      where: {
        // SCHEDULED BOOKINGS: include future-dated bookings so the
        // driver can pre-accept them. The `scheduledAt` column is
        // also surfaced (via publicOrderSelect) so the UI can
        // render the booking time on the card.
        // Ordering puts the soonest-due order first, so the driver
        // sees the most urgent scheduled booking at the top.
        status: { in: ['searching', 'scheduled'] },
      },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
      orderBy: [
        // Scheduled orders: soonest `scheduledAt` first so the most
        // imminent booking bubbles to the top of the list.
        { scheduledAt: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
