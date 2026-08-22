import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { AdminStats } from '@/lib/types';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toIsoDay(d: Date): string {
  // YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// GET /api/admin/stats  (admin only)
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const [
      totalOrders,
      totalDrivers,
      activeDrivers,
      pendingOrders,
      deliveredOrders,
      todayOrders,
      allDeliveredOrders,
    ] = await Promise.all([
      db.order.count(),
      db.driver.count(),
      db.driver.count({ where: { isOnline: true } }),
      db.order.count({ where: { status: 'searching' } }),
      db.order.count({ where: { status: 'delivered' } }),
      db.order.count({
        where: {
          createdAt: {
            gte: startOfDay(new Date()),
          },
        },
      }),
      db.order.findMany({
        where: { status: 'delivered' },
        select: {
          price: true,
          createdAt: true,
          deliveredAt: true,
          cargoType: true,
        },
      }),
    ]);

    const revenue = allDeliveredOrders.reduce((s, o) => s + o.price, 0);

    // avg delivery time in minutes (createdAt -> deliveredAt)
    let totalMins = 0;
    let counted = 0;
    for (const o of allDeliveredOrders) {
      if (o.deliveredAt) {
        const ms =
          new Date(o.deliveredAt).getTime() -
          new Date(o.createdAt).getTime();
        const mins = ms / 60000;
        if (mins >= 0) {
          totalMins += mins;
          counted++;
        }
      }
    }
    const avgDelivery = counted > 0 ? Math.round(totalMins / counted) : 0;

    // ordersByStatus — group by status across all orders.
    const statusCounts = await db.order.groupBy({
      by: ['status'],
      _count: true,
    });
    const ordersByStatus = statusCounts.map((s) => ({
      status: s.status,
      count: s._count,
    }));

    // revenueByDay: last 7 days
    const now = new Date();
    const revenueByDay: { day: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const rev = allDeliveredOrders.reduce((s, o) => {
        if (!o.deliveredAt) return s;
        const dt = new Date(o.deliveredAt);
        if (dt >= dayStart && dt < dayEnd) return s + o.price;
        return s;
      }, 0);
      revenueByDay.push({ day: toIsoDay(dayStart), revenue: rev });
    }

    // cargoBreakdown — group by cargoType across all orders.
    const cargoGroups = await db.order.groupBy({
      by: ['cargoType'],
      _count: true,
    });
    const cargoBreakdown = cargoGroups.map((g) => ({
      cargo: g.cargoType,
      count: g._count,
    }));

    const stats: AdminStats = {
      totalOrders,
      totalDrivers,
      activeDrivers,
      pendingOrders,
      deliveredOrders,
      todayOrders,
      revenue,
      avgDelivery,
      ordersByStatus,
      revenueByDay,
      cargoBreakdown,
    };
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
