// PHASE 10 — server-side cart mirror (dual-write with the localStorage cart).
//
// GET    /api/craft/cart — the caller's own cart, hydrated for display.
// PUT    /api/craft/cart — full replacement of the caller's mirror lines.
// DELETE /api/craft/cart — drop the caller's mirror (explicit clear).
//
// SECURITY:
//   - Everything is scoped to `session.id`; the body can never choose a user.
//   - The PUT body accepts ids + qty + a coupon CODE only — no price, no
//     total. The GET response recomputes display prices from the DB, and
//     checkout (POST /api/craft/orders) stays the only authority that
//     charges anything: Phase 10 adds a MIRROR, not pricing power.
//   - PHASE 9 moderation: lines are only stored/served for products passing
//     the SAME public visibility predicate as the storefront (isActive +
//     publicProductGate + active store), so a suspended/rejected product can
//     never be (re)introduced through this mirror, and hydration never
//     returns its name/price/image.
//   - Fire-and-forget callers: errors are logged generically, never echoed
//     (no exception details in responses).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { publicProductGate } from '@/lib/marketplace-moderation';
import { unitPriceFor } from '@/lib/craft-pricing';

// Zod objects strip unknown keys by default, so a smuggled `price`/`total`
// in the body is discarded before we ever build the write — and we still
// only pick the three known fields explicitly below (defence in depth).
const putSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        variantId: z.string().min(1).max(64).nullable().optional(),
        qty: z.number().int().min(1).max(100),
      })
    )
    .max(50, 'tooManyItems'),
  couponCode: z.string().trim().min(2).max(40).nullable().optional(),
});

// The storefront's public-visibility predicate (Phase 9): same whitelist the
// search/list endpoints use, so this mirror cannot become a back door.
function visibleProductWhere(ids: string[]) {
  return {
    id: { in: ids },
    isActive: true,
    ...publicProductGate,
    artisan: { status: 'active' as const },
  };
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftcart:get:${session.id}`, 60, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const cart = await db.cart.findUnique({
      where: { userId: session.id },
      include: { items: true },
    });
    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ items: [], couponCode: cart?.couponCode ?? null });
    }

    // Hydrate display fields from the DB for publicly visible products only.
    const productIds = [...new Set(cart.items.map((i) => i.productId))];
    const products = await db.craftProduct.findMany({
      where: visibleProductWhere(productIds),
      select: {
        id: true,
        nameAr: true,
        price: true,
        images: true,
        variants: { select: { id: true, priceAdjustment: true } },
        tiers: { select: { minQuantity: true, unitPrice: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = cart.items.flatMap((line) => {
      const p = byId.get(line.productId);
      // Hidden/deleted product: omit the line entirely (no name/price leak);
      // the next client PUT replaces the mirror and drops the row.
      if (!p) return [];
      const variant = line.variantId
        ? p.variants.find((v) => v.id === line.variantId)
        : undefined;
      return [
        {
          productId: p.id,
          variantId: line.variantId,
          nameAr: p.nameAr,
          // Display preview only — identical maths to the client's tier
          // preview, always recomputed from DB values.
          price: unitPriceFor(p.price, variant?.priceAdjustment ?? 0, line.quantity, p.tiers),
          image: p.images[0] ?? null,
          qty: line.quantity,
        },
      ];
    });

    return NextResponse.json({ items, couponCode: cart.couponCode });
  } catch (e) {
    console.error('[api/craft/cart GET]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftcart:put:${session.id}`, 120, 60 * 1000);
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
    // Dedupe by productId|variantId (the @@unique index cannot dedupe NULL
    // variantIds in Postgres — see the CartItem model comment). Max-merge for
    // a defensive duplicate, matching the client merge policy.
    const deduped = new Map<string, { productId: string; variantId: string | null; qty: number }>();
    for (const line of parsed.data.items) {
      const variantId = line.variantId ?? null;
      const key = `${line.productId}|${variantId ?? ''}`;
      const existing = deduped.get(key);
      if (!existing || line.qty > existing.qty) {
        deduped.set(key, { productId: line.productId, variantId, qty: line.qty });
      }
    }

    // Keep only lines whose product is publicly visible RIGHT NOW: the FK
    // requires the product to exist, and Phase 9 requires it to be public.
    const candidateIds = [...deduped.keys()].map((k) => k.split('|')[0]);
    const visible = await db.craftProduct.findMany({
      where: visibleProductWhere([...new Set(candidateIds)]),
      select: { id: true },
    });
    const visibleIds = new Set(visible.map((p) => p.id));
    const kept = [...deduped.values()].filter((l) => visibleIds.has(l.productId));

    const rawCoupon = parsed.data.couponCode ?? null;
    const couponCode = rawCoupon ? rawCoupon.toUpperCase() : null;

    const cart = await db.cart.upsert({
      where: { userId: session.id },
      create: { userId: session.id, couponCode },
      update: { couponCode },
    });
    await db.$transaction([
      db.cartItem.deleteMany({ where: { cartId: cart.id } }),
      ...(kept.length > 0
        ? [
            db.cartItem.createMany({
              data: kept.map((l) => ({
                cartId: cart.id,
                productId: l.productId,
                variantId: l.variantId,
                quantity: l.qty,
              })),
            }),
          ]
        : []),
    ]);

    // Deliberately no counts echoed back: a line-by-line count would let a
    // caller probe which product ids are publicly visible.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/craft/cart PUT]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit(`craftcart:delete:${session.id}`, 30, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    // Cascade removes the CartItem rows (onDelete: Cascade on Cart.items).
    await db.cart.deleteMany({ where: { userId: session.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/craft/cart DELETE]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}
