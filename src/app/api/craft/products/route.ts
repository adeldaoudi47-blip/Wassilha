import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { requireActiveArtisan } from '@/lib/auth';
import { publicCraftProductSelect } from '@/lib/dto';
import { allocateProductSlug } from '@/lib/slug-allocate';

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


// POST /api/craft/products
// Artisan-only (ACTIVE store). Creates a product owned by the artisan.
// Server-authoritative - the price is validated + stored as-is (no client
// can tamper at creation; the exact integer DZD amount is persisted).
// HIRFA Phase 3: pricing helpers shared with the [id] PATCH route.
import { computeBasePrice } from '@/lib/craft-pricing';

const createSchema = z.object({
  nameAr: z.string().trim().min(2, 'nameTooShort').max(120, 'nameTooLong'),
  nameFr: z.string().trim().max(120).optional().nullable(),
  descriptionAr: z.string().trim().max(2000).optional().nullable(),
  descriptionFr: z.string().trim().max(2000).optional().nullable(),
  price: z.number().int().min(1).max(10_000_000),
  categoryId: z.string().min(1),
  images: z.array(z.string().url()).max(8).default([]),
  stock: z.number().int().min(0).max(100_000).default(1),
  isFeatured: z.boolean().default(false),
  isMadeToOrder: z.boolean().default(false),
  // HIRFA Phase 3: optional product video (YouTube/Vimeo/Blob URL).
  videoUrl: z.string().trim().url().max(500).optional().nullable(),
  // HIRFA Phase 3: variants (SKUs) and graduated wholesale tiers.
  variants: z
    .array(
      z.object({
        nameAr: z.string().trim().min(1).max(80),
        nameFr: z.string().trim().max(80).optional().nullable(),
        priceAdjustment: z.number().int().min(-1_000_000).max(1_000_000).default(0),
        stock: z.number().int().min(0).max(100_000).default(0),
      })
    )
    .max(50)
    .default([]),
  tiers: z
    .array(
      z.object({
        minQuantity: z.number().int().min(1).max(100_000),
        unitPrice: z.number().int().min(0).max(10_000_000),
      })
    )
    .max(20)
    .default([]),
});

export async function POST(req: NextRequest) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }
    const category = await db.craftCategory.findUnique({
      where: { id: parsed.data.categoryId },
      select: { isActive: true },
    });
    if (!category || !category.isActive) {
      return NextResponse.json({ error: 'invalidCategory' }, { status: 400 });
    }
    // HIRFA Phase 3: graduated pricing sanity check — a tier valid at a higher
    // quantity must not be MORE expensive than one valid at a lower quantity,
    // otherwise buying more costs more which contradicts the feature contract.
    const sortedTiers = [...parsed.data.tiers].sort((a, b) => a.minQuantity - b.minQuantity);
    for (let i = 1; i < sortedTiers.length; i++) {
      if (sortedTiers[i].unitPrice > sortedTiers[i - 1].unitPrice) {
        return NextResponse.json({ error: 'tierPricingInvalid' }, { status: 400 });
      }
    }
    const product = await db.craftProduct.create({
      data: {
        artisanId: gate.artisanId,
        categoryId: parsed.data.categoryId,
        nameAr: parsed.data.nameAr,
        nameFr: parsed.data.nameFr ?? null,
        descriptionAr: parsed.data.descriptionAr ?? null,
        descriptionFr: parsed.data.descriptionFr ?? null,
        price: parsed.data.price,
        // The "from" price: the lowest reachable unit price across
        // variants/tiers, so tiles can show "ابتداءً من X". 0 = no
        // variants/tiers → the UI falls back to `price`.
        basePrice: computeBasePrice(parsed.data.price, parsed.data.variants, sortedTiers),
        videoUrl: parsed.data.videoUrl ?? null,
        images: parsed.data.images,
        stock: parsed.data.stock,
        isFeatured: parsed.data.isFeatured,
        isMadeToOrder: parsed.data.isMadeToOrder,
      },
    });
    // HIRFA Phase 3: write the variant / tier rows in a single round trip.
    // Both are children of the product (cascade delete), so a later product
    // delete cleans them up automatically.
    if (parsed.data.variants.length || sortedTiers.length) {
      await db.$transaction([
        ...(parsed.data.variants.length
          ? [db.productVariant.createMany({ data: parsed.data.variants.map((v) => ({ productId: product.id, nameAr: v.nameAr, nameFr: v.nameFr ?? null, priceAdjustment: v.priceAdjustment, stock: v.stock })) })]
          : []),
        ...(sortedTiers.length
          ? [db.productTier.createMany({ data: sortedTiers.map((tt) => ({ productId: product.id, minQuantity: tt.minQuantity, unitPrice: tt.unitPrice })) })]
          : []),
      ]);
    }
    // Stable public product slug — generated ONCE at creation, unique within
    // this store, and never regenerated on rename (URL stability).
    const slug = await allocateProductSlug(parsed.data.nameAr, gate.artisanId, product.id);
    await db.craftProduct.update({ where: { id: product.id }, data: { slug } });
    return NextResponse.json({ ...product, slug }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
