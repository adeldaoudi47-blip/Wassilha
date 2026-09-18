// HIRFAA — Public marketplace store tiles.
// GET /api/craft/marketplace/stores?q=<name>
// Public (no auth). Returns ACTIVE artisan stores only, with product count
// and rating. NO userId / phone / coords (uses the public projection).
// Phase 2A: optional ?q= filters stores by name (search page store results).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseCraftSearchFilters } from '@/lib/craft-search';
import { buildCraftStoreWhere } from '@/lib/craft-search-query';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const f = parseCraftSearchFilters(searchParams);
    const q = f.q.trim();

    const stores = await db.artisanProfile.findMany({
      where: buildCraftStoreWhere(f),
      select: {
        id: true,
        slug: true,
        displayName: true,
        avatarUrl: true,
        rating: true,
        totalSales: true,
        area: { select: { nameAr: true, nameFr: true } },
        _count: { select: { products: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });

    return NextResponse.json(
      stores.map((s) => ({
        id: s.id,
        slug: s.slug,
        displayName: s.displayName,
        avatarUrl: s.avatarUrl,
        rating: s.rating,
        totalSales: s.totalSales,
        productCount: s._count.products,
        area: s.area,
      }))
    );
  } catch (e) {
    console.error('[api/craft/marketplace/stores]', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
