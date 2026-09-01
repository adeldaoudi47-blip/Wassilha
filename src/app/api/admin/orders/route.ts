import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';

// GET /api/admin/orders  (admin only)
//
// SECURITY: even the privileged admin must never receive raw `User`
// rows. The response strips `passwordHash`, `email`, `phoneVerified`,
// `accountStatus`, and all relations. If the admin ever needs the raw
// email for support, expose a separate gated endpoint that explicitly
// requires an audit reason in the body.
export async function GET() {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
    const orders = await db.order.findMany({
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
