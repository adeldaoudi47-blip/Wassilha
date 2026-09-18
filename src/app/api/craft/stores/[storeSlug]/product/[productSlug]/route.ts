// HIRFAA Phase 1 — Public product page endpoint.
// GET /api/craft/stores/[storeSlug]/product/[productSlug]
// Public (no auth). Resolves via the stable slugs; falls back to id-based
// resolution only if the slug is missing (backfill window).
// Returns the full public product projection (NO sensitive artisan fields).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { marketplaceProductSelect } from '@/lib/dto';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ storeSlug: string; productSlug: string }> }
) {
  const { storeSlug, productSlug } = await params;
  try {
    // Resolve the store first (slug is unique globally). Fall back to id prefix
    // for any rows still in the backfill window so public URLs never 404.
    const artisan = await db.artisanProfile.findFirst({
      where: {
        OR: [{ slug: storeSlug }, { id: { startsWith: storeSlug.replace(/^store-/, '') } }],
      },
      select: { id: true, slug: true, status: true },
    });
    if (!artisan || artisan.status !== 'active') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Resolve the product by stable slug within this store. Fall back to id prefix.
    const product = await db.craftProduct.findFirst({
      where: {
        artisanId: artisan.id,
        isActive: true,
        OR: [
          { slug: productSlug },
          { id: { startsWith: productSlug.replace(/^product-/, '') } },
        ],
      },
      select: marketplaceProductSelect,
    });

    if (!product) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ store: artisan, product });
  } catch (e) {
    console.error('[api/craft/stores/.../product/...]', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
