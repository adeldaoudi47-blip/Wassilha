// PHASE 10 — favourites mirror, collection route.
//
// GET /api/craft/favorites → { productIds: string[] } — the caller's saved
//   ids ONLY. No product payload ever crosses this endpoint, so it cannot
//   surface name/price/image of a product that was later suspended (Phase 9).
// PUT /api/craft/favorites → replace the caller's whole id set (used by the
//   login merge). Ids are validated against PUBLICLY VISIBLE products only,
//   so a hidden/deleted product can never be (re)introduced through sync.
//
// Everything is scoped to session.id; zod strips unknown keys; generic
// errors only (no exception details echoed).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { publicProductGate } from '@/lib/marketplace-moderation';

const putSchema = z.object({
  // Generous cap: a wishlist is unbounded in the UI, but the sync payload
  // must stay bounded so the endpoint cannot be used as a bulk-write pump.
  productIds: z.array(z.string().min(1).max(64)).max(500),
});

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftfav:get:${session.id}`, 60, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const rows = await db.favorite.findMany({
      where: { userId: session.id },
      select: { productId: true },
    });
    return NextResponse.json({ productIds: rows.map((r) => r.productId) });
  } catch (e) {
    console.error('[api/craft/favorites GET]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftfav:put:${session.id}`, 60, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalidPayload' }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalidPayload' }, { status: 400 });
  }

  try {
    const ids = [...new Set(parsed.data.productIds)];

    // PHASE 9: only publicly visible products may be persisted as favourite
    // — otherwise this route would let a client re-add ids of suspended or
    // rejected products to an account and probe them later via GET.
    const visible = ids.length
      ? await db.craftProduct.findMany({
          where: {
            id: { in: ids },
            isActive: true,
            ...publicProductGate,
            artisan: { status: 'active' as const },
          },
          select: { id: true },
        })
      : [];
    const visibleIds = visible.map((p) => p.id);

    await db.$transaction([
      db.favorite.deleteMany({ where: { userId: session.id } }),
      ...(visibleIds.length > 0
        ? [
            db.favorite.createMany({
              data: visibleIds.map((productId) => ({ userId: session.id, productId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/craft/favorites PUT]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}