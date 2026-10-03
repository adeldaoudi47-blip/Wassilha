import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { adminCraftOrderSelect } from '@/lib/dto';

// GET /api/admin/craft/orders   (privileged admin only)
//
// Marketplace ORDER oversight — the admin view of CraftOrder (marketplace
// purchases), which is a DIFFERENT table from the transport `Order` that
// ../admin/orders lists. The two are deliberately not merged.
//
// MONEY IS SHOWN AS TWO FIGURES, NEVER ONE SUM:
//   `totalPrice`                     -> PRODUCT subtotal after coupon (seller's)
//   `deliveryOrder.price|finalPrice` -> the WASSILHA DELIVERY FEE (driver's)
// They live on separate rows and are not added together anywhere in this
// codebase; the admin UI renders them as two labelled numbers so a delivery fee
// can never be misread as product revenue.
//
// Read-only by design: admin oversight here is for support/dispute work. The
// seller/customer lifecycle of a craft order is driven by the existing
// /api/craft/orders/[id]/status route, which enforces actor ownership.
export async function GET(_req: NextRequest) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const orders = await db.craftOrder.findMany({
      select: adminCraftOrderSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({ orders });
  } catch (e) {
    console.error('[api/admin/craft/orders]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}