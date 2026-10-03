import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireArtisan } from '@/lib/auth';
import { sellerCraftProductSelect } from '@/lib/dto';

// GET /api/craft/products/mine
// Artisan-only: the products owned by the current artisan. Used by the
// artisan dashboard (product list + edit/delete). No public PII is involved
// - the response carries every field the artisan manages.
//
// PHASE 9: this is a READ, so it uses `requireArtisan` (identity + ownership
// only) rather than `requireActiveArtisan`. A SUSPENDED seller must still be
// able to open their dashboard and see their products and the moderation
// verdict on each — otherwise a suspension would look like the app is broken
// and the seller could never correct the problem. Every WRITE on those same
// products still goes through requireActiveArtisan, so this does not weaken
// the suspension.
export async function GET() {
  const gate = await requireArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const products = await db.craftProduct.findMany({
      where: { artisanId: gate.artisanId },
      // Seller-own projection: adds moderationStatus / moderationReason /
      // isActive, which must NOT appear on the public projection.
      select: sellerCraftProductSelect,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(products);
  } catch (e) {
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}
