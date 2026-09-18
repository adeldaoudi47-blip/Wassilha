// HIRFAA — Public marketplace product listing + search.
// GET /api/craft/marketplace/products
//
// Phase 1 params (unchanged, backward compatible): featured=1&page=1&pageSize=12
// Phase 2A search params: q & category (slug) & area (slug) & priceMin &
// priceMax & sort (latest|price_asc|price_desc|featured).
//
// Public (no auth). Reads active stores + active products only, via the shared
// marketplaceProductSelect projection (no sensitive fields).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { marketplaceProductSelect } from '@/lib/dto';
import { parseCraftSearchFilters, CRAFT_SEARCH_PAGE_SIZE } from '@/lib/craft-search';
import { buildCraftProductWhere, buildCraftProductOrderBy } from '@/lib/craft-search-query';

const MAX_PAGE_SIZE = 24;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const f = parseCraftSearchFilters(searchParams, CRAFT_SEARCH_PAGE_SIZE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, f.pageSize));
    // Legacy ?featured=1 flag still maps onto the same filter.
    const featured = searchParams.get('featured') === '1';

    const where = {
      ...buildCraftProductWhere(f),
      ...(featured ? { isFeatured: true } : {}),
    };

    const [products, total] = await Promise.all([
      db.craftProduct.findMany({
        where,
        select: marketplaceProductSelect,
        orderBy: buildCraftProductOrderBy(f.sort),
        skip: (f.page - 1) * pageSize,
        take: pageSize,
      }),
      db.craftProduct.count({ where }),
    ]);

    return NextResponse.json({
      products,
      total,
      page: f.page,
      pageSize,
      hasMore: total > f.page * pageSize,
      // Echo the applied filters so a client can trust what it rendered.
      filters: {
        q: f.q,
        category: f.category,
        area: f.area,
        priceMin: f.priceMin,
        priceMax: f.priceMax,
        sort: f.sort,
      },
    });
  } catch (e) {
    console.error('[api/craft/marketplace/products]', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
