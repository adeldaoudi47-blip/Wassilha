// HIRFA Phase 2A — Prisma query builders for the public marketplace search.
//
// Shared between the public API route (api/craft/marketplace/products) and the
// SSR search page so a URL and its API call ALWAYS agree on the result set.
import type { Prisma } from '@prisma/client';
import type { CraftSearchFilters } from './craft-search';

/**
 * WHERE clause for public product search.
 * Security invariants (same as Phase 1):
 *   - isActive === true
 *   - artisan.status === 'active'  (pending/rejected stores are invisible)
 */
export function buildCraftProductWhere(f: CraftSearchFilters): Prisma.CraftProductWhereInput {
  const q = f.q.trim();
  return {
    isActive: true,
    artisan: {
      status: 'active',
      // Area filter is a store property (workshop neighbourhood).
      ...(f.area ? { area: { slug: f.area } } : {}),
    },
    ...(f.category ? { category: { slug: f.category } } : {}),
    ...(f.priceMin !== null || f.priceMax !== null
      ? {
          price: {
            ...(f.priceMin !== null ? { gte: f.priceMin } : {}),
            ...(f.priceMax !== null ? { lte: f.priceMax } : {}),
          },
        }
      : {}),
    // Free-text: matches the product name/description (AR+FR), its category
    // name, OR the store name — one search box, several intents.
    ...(q
      ? {
          OR: [
            { nameAr: { contains: q, mode: 'insensitive' } },
            { nameFr: { contains: q, mode: 'insensitive' } },
            { descriptionAr: { contains: q, mode: 'insensitive' } },
            { descriptionFr: { contains: q, mode: 'insensitive' } },
            { category: { nameAr: { contains: q, mode: 'insensitive' } } },
            { category: { nameFr: { contains: q, mode: 'insensitive' } } },
            { artisan: { displayName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

export function buildCraftProductOrderBy(
  sort: CraftSearchFilters['sort']
): Prisma.CraftProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      // tie-break by recency so pagination is deterministic
      return [{ price: 'asc' }, { createdAt: 'desc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { createdAt: 'desc' }];
    case 'featured':
      // Featured first, then newest. With 0 featured rows this degrades to
      // "latest" — never an empty or broken result set.
      return [{ isFeatured: 'desc' }, { createdAt: 'desc' }];
    case 'latest':
    default:
      return [{ createdAt: 'desc' }];
  }
}

/**
 * WHERE clause for public STORE search by name (the search page shows matching
 * stores next to matching products).
 */
export function buildCraftStoreWhere(f: CraftSearchFilters): Prisma.ArtisanProfileWhereInput {
  const q = f.q.trim();
  return {
    status: 'active',
    ...(f.area ? { area: { slug: f.area } } : {}),
    ...(q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { bioAr: { contains: q, mode: 'insensitive' } }, { bioFr: { contains: q, mode: 'insensitive' } }] } : {}),
  };
}
