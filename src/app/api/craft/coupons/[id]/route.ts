// HIRFA Phase 3 — DELETE /api/craft/coupons/[id]
//
// Removes a coupon so it can no longer be redeemed. Redemption history is NOT
// affected: the discount already lives on the delivered CraftOrder rows
// (totalPrice is a snapshot), so deleting the coupon never rewrites the past.
//
// SECURITY: IDOR — the coupon must belong to the session's own artisan
// profile, checked before the delete.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const coupon = await db.coupon.findUnique({ where: { id }, select: { artisanId: true } });
    if (!coupon) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (coupon.artisanId !== gate.artisanId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    await db.coupon.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
