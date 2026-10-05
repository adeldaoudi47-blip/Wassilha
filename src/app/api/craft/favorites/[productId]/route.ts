// PHASE 10 — favourites mirror, single-product route.
//
// POST   /api/craft/favorites/[productId] — idempotent add.
// DELETE /api/craft/favorites/[productId] — idempotent remove.
//
// SECURITY / PHASE 9:
//   - Session-scoped: the favourite row is always (session.id, productId);
//     nobody can edit anyone else's list.
//   - POST requires the product to be PUBLICLY VISIBLE right now
//     (isActive + publicProductGate + active store), so the endpoint is not
//     an existence oracle for pending/suspended/rejected products: those
//     answer the same 404 as a non-existent id.
//   - The response carries only { ok, productId } — never product data.
//   - DELETE is idempotent and returns 200 even when nothing matched.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { publicProductGate } from '@/lib/marketplace-moderation';

type Ctx = { params: Promise<{ productId: string }> };

const idSchema = z.string().min(1).max(64);

export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftfav:add:${session.id}`, 60, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const { productId } = await params;
    if (!idSchema.safeParse(productId).success) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    // Visibility whitelist: hidden and non-existent ids are indistinguishable.
    const product = await db.craftProduct.findFirst({
      where: {
        id: productId,
        isActive: true,
        ...publicProductGate,
        artisan: { status: 'active' as const },
      },
      select: { id: true },
    });
    if (!product) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    await db.favorite.upsert({
      where: { userId_productId: { userId: session.id, productId } },
      create: { userId: session.id, productId },
      update: {},
    });
    return NextResponse.json({ ok: true, productId });
  } catch (e) {
    console.error('[api/craft/favorites POST]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftfav:del:${session.id}`, 60, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const { productId } = await params;
    if (!idSchema.safeParse(productId).success) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    // Idempotent: removing an absent row is a no-op, still 200.
    await db.favorite.deleteMany({ where: { userId: session.id, productId } });
    return NextResponse.json({ ok: true, productId });
  } catch (e) {
    console.error('[api/craft/favorites DELETE]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}