import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

// GET /api/driver/incoming  — orders with status='searching' available to online drivers.
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
      where: { status: 'searching' },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
