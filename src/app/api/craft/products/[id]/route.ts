import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { requireActiveArtisan } from '@/lib/auth';
import { publicCraftProductSelect } from '@/lib/dto';

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
}).refine((v) => Object.keys(v).length > 0, { message: 'emptyUpdate' });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { id } = await params;
    const existing = await db.craftProduct.findUnique({ where: { id }, select: { artisanId: true } });
    if (!existing) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (existing.artisanId !== gate.artisanId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    const data = parsed.data;
    if (data.categoryId) { const category = await db.craftCategory.findUnique({ where: { id: data.categoryId }, select: { isActive: true } }); if (!category || !category.isActive) return NextResponse.json({ error: 'invalidCategory' }, { status: 400 }); }
    const updated = await db.craftProduct.update({ where: { id }, data: { ...(data.nameAr ? { nameAr: data.nameAr } : {}), ...(data.nameFr !== undefined ? { nameFr: data.nameFr } : {}), ...(data.descriptionAr !== undefined ? { descriptionAr: data.descriptionAr } : {}), ...(data.descriptionFr !== undefined ? { descriptionFr: data.descriptionFr } : {}), ...(data.price !== undefined ? { price: data.price } : {}), ...(data.categoryId ? { categoryId: data.categoryId } : {}), ...(data.images !== undefined ? { images: data.images } : {}), ...(data.stock !== undefined ? { stock: data.stock } : {}), ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {}) } });
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
