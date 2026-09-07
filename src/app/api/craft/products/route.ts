import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicCraftProductSelect } from '@/lib/dto';

// GET /api/craft/products
// Public browse endpoint for the HIRFA marketplace.
//
// Query params:
//   categoryId - filter by CraftCategory id
//   artisanId  - filter by ArtisanProfile id (must still be active)
//   q          - free-text search over product name/description (AR+FR)
//                and the artisan display name
//   featured   - "1"/"true" restricts to featured products
//   page       - 1-based page number (default 1)
//   pageSize   - items per page (default 12, capped at 48)
//
// SECURITY / PII: every product is serialized through
// publicCraftProductSelect - the artisan phone, owning user id and exact
// workshop coords are never returned. Only products of artisans whose
// status is "active" are publicly visible.
const MAX_PAGE_SIZE = 48;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const categoryId = sp.get('categoryId') || undefined;
    const artisanId = sp.get('artisanId') || undefined;
    const q = (sp.get('q') || '').trim();
    const featured = ['1', 'true'].includes((sp.get('featured') || '').toLowerCase());
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(sp.get('pageSize') || '12', 10) || 12)
    );

    const where = {
      isActive: true,
      // Moderation + PII gate: only admin-approved artisan shops.
      artisan: {
        status: 'active',
        ...(artisanId ? { id: artisanId } : {}),
      },
      ...(categoryId ? { categoryId } : {}),
      ...(featured ? { isFeatured: true } : {}),
      ...(q
        ? {
            OR: [
              { nameAr: { contains: q, mode: 'insensitive' as const } },
              { nameFr: { contains: q, mode: 'insensitive' as const } },
              { descriptionAr: { contains: q, mode: 'insensitive' as const } },
              { descriptionFr: { contains: q, mode: 'insensitive' as const } },
              {
                artisan: {
                  displayName: { contains: q, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    const [products, total] = await Promise.all([
      db.craftProduct.findMany({
        where,
        select: publicCraftProductSelect,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.craftProduct.count({ where }),
    ]);

    return NextResponse.json({
      products,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
