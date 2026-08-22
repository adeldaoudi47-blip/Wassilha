import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// GET /api/driver/earnings
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const driver = await db.driver.findUnique({
      where: { userId: session.id },
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 404 });
    }

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    // All delivered orders for this driver (most recent first).
    const deliveredOrders = await db.order.findMany({
      where: {
        driverId: session.id,
        status: 'delivered',
      },
      include: { customer: true, driver: true },
      orderBy: { createdAt: 'desc' },
    });

    // thisWeek: sum of delivered order prices where deliveredAt is within last 7 days.
    const thisWeekOrders = deliveredOrders.filter((o) => {
      const dt = o.deliveredAt ? new Date(o.deliveredAt) : null;
      return dt && dt >= weekAgo;
    });
    const thisWeek = thisWeekOrders.reduce((s, o) => s + o.price, 0);

    // weekly breakdown: array of 7 entries {day, earnings}, oldest -> newest.
    const weekly: { day: string; earnings: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);

      const dayEarnings = deliveredOrders.reduce((s, o) => {
        const dt = o.deliveredAt ? new Date(o.deliveredAt) : null;
        if (dt && dt >= dayStart && dt < dayEnd) return s + o.price;
        return s;
      }, 0);

      weekly.push({ day: DAY_NAMES[dayStart.getDay()], earnings: dayEarnings });
    }

    // recent: last 10 orders for this driver (any status, sorted desc).
    const recent = await db.order.findMany({
      where: { driverId: session.id },
      include: { customer: true, driver: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      total: driver.totalEarnings,
      thisWeek,
      trips: driver.totalTrips,
      rating: driver.rating,
      recent,
      weekly,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
