import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requirePrivilegedAdmin } from '@/lib/auth';
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

// DELETE /api/orders/:id
//
// Authorization model (one endpoint, role-aware):
//   * admin   -> may delete any order, regardless of status.
//   * customer -> may delete ONLY their own orders, and ONLY when the
//                 order is in a terminal state (`delivered` or
//                 `cancelled`). This prevents customers from deleting
//                 active orders mid-flight, which would break the
//                 race-condition-safe status transitions implemented
//                 in /api/orders/:id/{accept,pickup,deliver,cancel}.
//   * driver  -> never. Drivers don't own orders.
//
// SECURITY: related `Rating` rows are dropped via the Prisma cascade
// on Order.ratings (see schema.prisma `Order.ratings Rating[]` with
// `onDelete: Cascade`). This avoids orphaned rating records if a
// customer retroactively deletes a completed order.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    // Fast-path: admins bypass the per-row status guard.
    const adminGate = await requirePrivilegedAdmin();
    if (adminGate.ok) {
      // Privileged admin: delete any order, any status, no checks.
      await db.order.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Non-admin path. The admin gate above returned `ok: false` for one
    // of two reasons: no session (401) or wrong role (403). Both cases
    // mean we're a non-admin caller, so re-check the session here.

    const order = await db.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    if (session.role === 'admin') {
      // Defensive: a non-privileged admin (role='admin' but phone !=
      // PRIVILEGED_ADMIN_PHONE) lands here. We deliberately reject
      // them — the privileged-admin gate is the *only* way to delete
      // someone else's order.
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (session.role !== 'customer') {
      // drivers and any other future role are denied outright.
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (order.status !== 'delivered' && order.status !== 'cancelled') {
      // Deleting an in-flight order would orphan an active dispatch
      // (driver pulling up, package en-route, etc.). We refuse and ask
      // the client to cancel the order first if they really want out.
      return NextResponse.json(
        { error: 'notDeletable', status: order.status },
        { status: 409 }
      );
    }

    await db.order.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
