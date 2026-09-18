// HIRFAA Phase 1 — Public storefront endpoint.
// GET /api/craft/stores/[storeSlug]  →  full public store profile + active products.
// Public (no auth). Reuses publicArtisanStoreSelect / marketplaceProductSelect
// projections — never returns userId / phone / coords / owner id.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicArtisanStoreSelect, marketplaceProductSelect } from '@/lib/dto';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ storeSlug: string }> }
) {
  const { storeSlug } = await params;
  try {
    const artisan = await db.artisanProfile.findUnique({
      where: { slug: storeSlug },
      select: {
        ...publicArtisanStoreSelect,
        status: true,
        products: {
          where: { isActive: true },
          select: marketplaceProductSelect,
          orderBy: { createdAt: 'desc' },
          take: 24,
        },
        _count: { select: { products: { where: { isActive: true } } } },
      },
    });

    if (!artisan) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // A store is only publicly browsable when the artisan is ACTIVE.
    if (artisan.status !== 'active') {
      return NextResponse.json({ error: 'store_unavailable' }, { status: 404 });
    }

    const { products, _count, ...store } = artisan;
    return NextResponse.json({
      store,
      products,
      productCount: _count.products,
    });
  } catch (e) {
    console.error('[api/craft/stores/[storeSlug]]', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
