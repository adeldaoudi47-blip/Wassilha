import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';
import { publicCraftProductSelect } from '@/lib/dto';

// GET /api/craft/products/mine
// Artisan-only: the products owned by the current artisan. Used by the
// artisan dashboard (product list + edit/delete). No public PII is involved
// - the response carries every field the artisan manages.
export async function GET() {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const products = await db.craftProduct.findMany({
      where: { artisanId: gate.artisanId },
      select: publicCraftProductSelect,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(products);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
