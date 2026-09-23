import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { requireActiveArtisan } from '@/lib/auth';
import { publicCraftProductSelect } from '@/lib/dto';
// HIRFA Phase 3: shared pricing helpers (base-price recomputation).
import { computeBasePrice } from '@/lib/craft-pricing';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const product = await db.craftProduct.findFirst({ where: { id, isActive: true, artisan: { status: 'active' } }, select: publicCraftProductSelect });
    if (!product) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

const updateSchema = z.object({
  nameAr: z.string().trim().min(2).max(120).optional(),
  nameFr: z.string().trim().max(120).optional().nullable(),
  descriptionAr: z.string().trim().max(2000).optional().nullable(),
  descriptionFr: z.string().trim().max(2000).optional().nullable(),
  price: z.number().int().min(1).max(10_000_000).optional(),
  categoryId: z.string().min(1).optional(),
  images: z.array(z.string().url()).max(8).optional(),
  stock: z.number().int().min(0).max(100_000).optional(),
  isFeatured: z.boolean().optional(),
  isMadeToOrder: z.boolean().optional(),
  // HIRFA Phase 3
  videoUrl: z.string().trim().url().max(500).optional().nullable(),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        nameAr: z.string().trim().min(1).max(80),
        nameFr: z.string().trim().max(80).optional().nullable(),
        priceAdjustment: z.number().int().min(-1_000_000).max(1_000_000).default(0),
        stock: z.number().int().min(0).max(100_000).default(0),
      })
    )
    .max(50)
    .optional(),
  tiers: z
    .array(
      z.object({
        minQuantity: z.number().int().min(1).max(100_000),
        unitPrice: z.number().int().min(0).max(10_000_000),
      })
    )
    .max(20)
    .optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'emptyUpdate' });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { id } = await params;
    const existing = await db.craftProduct.findUnique({ where: { id }, select: { artisanId: true, price: true } });
    if (!existing) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (existing.artisanId !== gate.artisanId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    const data = parsed.data;
    if (data.categoryId) { const category = await db.craftCategory.findUnique({ where: { id: data.categoryId }, select: { isActive: true } }); if (!category || !category.isActive) return NextResponse.json({ error: 'invalidCategory' }, { status: 400 }); }

    // HIRFA Phase 3: tier monotonicity check (same rule as creation).
    const sortedTiers = data.tiers ? [...data.tiers].sort((a, b) => a.minQuantity - b.minQuantity) : null;
    if (sortedTiers) {
      for (let i = 1; i < sortedTiers.length; i++) {
        if (sortedTiers[i].unitPrice > sortedTiers[i - 1].unitPrice) {
          return NextResponse.json({ error: 'tierPricingInvalid' }, { status: 400 });
        }
      }
    }
    // HIRFA Phase 3: variants/tiers are sent as a FULL replacement (the form
    // owns the whole list). Rows are rebuilt inside one transaction so a
    // failure never leaves a product with half its SKUs. Existing variants
    // referenced by a delivered order line are preserved through their
    // onDelete: SetNull snapshot on CraftOrderItem.
    if (data.variants || sortedTiers) {
      await db.$transaction(async (tx) => {
        if (data.variants) {
          await tx.productVariant.deleteMany({ where: { productId: id } });
          if (data.variants.length) {
            await tx.productVariant.createMany({
              data: data.variants.map((v) => ({
                productId: id,
                nameAr: v.nameAr,
                nameFr: v.nameFr ?? null,
                priceAdjustment: v.priceAdjustment,
                stock: v.stock,
              })),
            });
          }
        }
        if (sortedTiers) {
          await tx.productTier.deleteMany({ where: { productId: id } });
          if (sortedTiers.length) {
            await tx.productTier.createMany({
              data: sortedTiers.map((tt) => ({ productId: id, minQuantity: tt.minQuantity, unitPrice: tt.unitPrice })),
            });
          }
        }
      });
    }
    // Recompute the "from" price whenever the inputs that feed it changed.
    const priceForBase = data.price ?? existing.price;
    const basePrice =
      data.variants || sortedTiers || data.price !== undefined
        ? computeBasePrice(priceForBase, data.variants ?? [], sortedTiers ?? [])
        : undefined;

    const updated = await db.craftProduct.update({ where: { id }, data: { ...(data.nameAr ? { nameAr: data.nameAr } : {}), ...(data.nameFr !== undefined ? { nameFr: data.nameFr } : {}), ...(data.descriptionAr !== undefined ? { descriptionAr: data.descriptionAr } : {}), ...(data.descriptionFr !== undefined ? { descriptionFr: data.descriptionFr } : {}), ...(data.price !== undefined ? { price: data.price } : {}), ...(data.categoryId ? { categoryId: data.categoryId } : {}), ...(data.images !== undefined ? { images: data.images } : {}), ...(data.stock !== undefined ? { stock: data.stock } : {}), ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {}), ...(data.isMadeToOrder !== undefined ? { isMadeToOrder: data.isMadeToOrder } : {}), ...(data.videoUrl !== undefined ? { videoUrl: data.videoUrl ?? null } : {}), ...(basePrice !== undefined ? { basePrice } : {}) } });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { id } = await params;
    const existing = await db.craftProduct.findUnique({ where: { id }, select: { artisanId: true } });
    if (!existing) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (existing.artisanId !== gate.artisanId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const inUse = await db.craftOrderItem.count({ where: { productId: id } });
    if (inUse > 0) return NextResponse.json({ error: 'productInUse' }, { status: 409 });
    await db.craftProduct.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
