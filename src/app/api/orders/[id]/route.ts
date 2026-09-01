import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/orders/:id
//
// SECURITY: authentication required, then ownership/assignment authorization:
//   customer -> only orders they created
//   driver   -> only orders assigned to them
//   admin    -> all orders
//
// SECURITY: only the public subset of `User` fields is returned (id, phone,
// name, role, avatar). Sensitive fields (passwordHash, email, phoneVerified,
// accountStatus) are excluded via `publicUserSelect`.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const order = await db.order.findUnique({
      where: { id },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    if (session.role !== 'admin') {
      const allowed =
        session.role === 'customer'
          ? order.customerId === session.id
          : session.role === 'driver'
            ? order.driverId === session.id
            : false;
      if (!allowed) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(order);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
