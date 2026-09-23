import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { publicCraftOrderSelect } from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
// HIRFA Phase 3: server-authoritative pricing (variants / tiers / coupons).
import { couponDiscount, pickTier, unitPriceFor } from '@/lib/craft-pricing';

// POST /api/craft/orders
// Customer-only. Creates a craft order from the client-side cart.
//
// SECURITY (OWASP V7 — price tampering):
//   - totalPrice is ALWAYS computed server-side from CraftProduct.price
//     (the DB value, never the client-submitted price).
//   - Stock is checked AND decremented inside a transaction to prevent
//     race conditions (two customers buying the last item simultaneously).
//   - HIRFA Phase 3: the same guarantees extend to the variant-level stock,
//     the graduated tier unit price, and the coupon discount. The client may
//     send a variantId + a coupon CODE, but the numbers are always recomputed
//     here and the coupon redemption is atomic with the order creation.
const createSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(100),
        // HIRFA Phase 3: the chosen variant (SKU), optional. The server
        // verifies the variant actually belongs to this product.
        variantId: z.string().min(1).optional().nullable(),
      })
    )
    .min(1, 'emptyCart')
    .max(50, 'tooManyItems'),
  deliveryOption: z.enum(['pickup']).default('pickup'),
  notes: z.string().trim().max(500).optional(),
  // HIRFA Phase 3: optional discount code. Validated (and redeemed) only
  // after the server resolved the subtotal — the client never tells us how
  // much the discount is.
  couponCode: z.string().trim().min(2).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }

    const { items, deliveryOption, notes, couponCode } = parsed.data;

    // Deduplicate items (same productId + variant merged into one line with
    // summed qty). The variant is part of the key: two different sizes of the
    // same product stay two separate order lines.
    const merged = new Map<string, { productId: string; variantId: string | null; qty: number }>();
    for (const it of items) {
      const key = `${it.productId}|${it.variantId ?? ''}`;
      const prev = merged.get(key);
      if (prev) prev.qty += it.quantity;
      else merged.set(key, { productId: it.productId, variantId: it.variantId ?? null, qty: it.quantity });
    }
    const productIds = Array.from(new Set(merged.values().map((m) => m.productId)));

    // Transaction: verify stock, create order(s), decrement stock.
    //
    // HIRFA Phase 2B: the public cart may legitimately hold products from
    // SEVERAL stores. A CraftOrder belongs to ONE artisan (the schema models a
    // single artisanId per order), so items are grouped by their owning artisan
    // and ONE order is created per store. Before this, a multi-store checkout
    // attributed the whole cart to the FIRST product's artisan: the other
    // seller's stock was decremented but they never saw the order. Everything
    // stays inside one transaction, so a failure leaves no partial state.
    // HIRFA Phase 3: the same transaction now also resolves variants, applies
    // graduated tier pricing, validates + redeems the coupon (atomic
    // `usedCount` increment guarded by `usageLimit`), and decrements the
    // variant-level stock. A coupon is scoped to ONE artisan, so it can only
    // apply to the store it belongs to.
    const created = await db.$transaction(async (tx) => {
      const products = await tx.craftProduct.findMany({
        where: { id: { in: productIds }, isActive: true, artisan: { status: 'active' } },
        select: {
          id: true,
          price: true,
          stock: true,
          artisanId: true,
          nameAr: true,
          isMadeToOrder: true,
          // HIRFA Phase 3: the graduated price table for this product.
          tiers: { select: { minQuantity: true, unitPrice: true } },
        },
      });

      if (products.length !== productIds.length) throw new Error('productNotFound');

      const stockMap = new Map(products.map((p) => [p.id, p]));

      // HIRFA Phase 3: load every referenced variant in one round trip and
      // index them by id so we can (a) verify the variant belongs to the
      // product and (b) read its adjustment + own stock.
      const variantIds = Array.from(merged.values()).map((m) => m.variantId).filter((v): v is string => !!v);
      const variantRows = variantIds.length
        ? await tx.productVariant.findMany({ where: { id: { in: variantIds } } })
        : [];
      const variantMap = new Map(variantRows.map((v) => [v.id, v]));

      // Variant integrity check: a variant must exist AND belong to the exact
      // product the client claims it belongs to (no cross-product injection).
      for (const m of merged.values()) {
        if (m.variantId) {
          const v = variantMap.get(m.variantId);
          if (!v || v.productId !== m.productId) throw new Error('invalidVariant');
        }
      }

      // Stock check (product-level AND variant-level).
      for (const m of merged.values()) {
        const product = stockMap.get(m.productId);
        // Made-to-order products are crafted on demand: stock is never a
        // limiting factor for them, so only stock-tracked products are checked.
        if (!product) throw new Error('productNotFound');
        if (!product.isMadeToOrder && product.stock < m.qty) throw new Error('insufficientStock');
        // A variant has its own stock; 0 means this SKU is sold out even if
        // the product-level stock is fine.
        if (m.variantId) {
          const v = variantMap.get(m.variantId)!;
          if (!product.isMadeToOrder && v.stock < m.qty) throw new Error('insufficientStock');
        }
      }

      // HIRFA Phase 3: resolve the coupon ONCE, up-front. It is scoped to a
      // single artisan; if the cart spans several stores the coupon only
      // discounts the matching store's order. The conditional atomic increment
      // below is what makes two customers racing for the last slot safe.
      let couponRow: {
        id: string;
        artisanId: string | null;
        type: string;
        value: number;
        usageLimit: number | null;
      } | null = null;
      if (couponCode) {
        const found = await tx.coupon.findUnique({
          where: { code: couponCode.toUpperCase() },
          select: { id: true, artisanId: true, type: true, value: true, expiresAt: true, usageLimit: true, usedCount: true },
        });
        if (!found) throw new Error('couponNotFound');
        if (found.expiresAt && found.expiresAt < new Date()) throw new Error('couponExpired');
        if (found.usageLimit !== null && found.usageLimit !== undefined && found.usedCount >= found.usageLimit) {
          throw new Error('couponExhausted');
        }
        if (found.type !== 'percent' && found.type !== 'fixed') throw new Error('couponInvalid');
        couponRow = found;
      }

      // Group line items by the artisan who actually owns each product.
      const byArtisan = new Map<string, { productId: string; variantId: string | null; qty: number }[]>();
      for (const m of merged.values()) {
        const owner = stockMap.get(m.productId)!.artisanId;
        if (!byArtisan.has(owner)) byArtisan.set(owner, []);
        byArtisan.get(owner)!.push(m);
      }

      const orders: Prisma.CraftOrderGetPayload<{ select: typeof publicCraftOrderSelect }>[] = [];
      for (const [artisanId, lineItems] of byArtisan) {
        // Compute totalPrice server-side from DB prices for THIS store only,
        // applying the graduated tier pricing + variant adjustment.
        let subtotal = 0;
        const linePayload: { productId: string; quantity: number; unitPrice: number; variantId?: string }[] = [];
        for (const li of lineItems) {
          const product = stockMap.get(li.productId)!;
          const variant = li.variantId ? variantMap.get(li.variantId)! : null;
          const adjustment = variant ? variant.priceAdjustment : 0;
          const unit = unitPriceFor(product.price, adjustment, li.qty, product.tiers);
          subtotal += unit * li.qty;
          linePayload.push({
            productId: li.productId,
            quantity: li.qty,
            unitPrice: unit,
            ...(variant ? { variantId: variant.id } : {}),
          });
        }

        // HIRFA Phase 3: apply the coupon to THIS order only when it is
        // scoped to this store (or is platform-wide, artisanId = null).
        let discount = 0;
        if (couponRow && (couponRow.artisanId === artisanId || couponRow.artisanId === null)) {
          discount = couponDiscount(couponRow.type, couponRow.value, subtotal);
        }

        // Generate unique order code
        let code = generateOrderCode();
        let attempts = 0;
        while (await tx.craftOrder.count({ where: { code } }) > 0) {
          code = generateOrderCode();
          if (++attempts > 10) throw new Error('codeGenFailed');
        }

        const order = await tx.craftOrder.create({
          data: {
            code,
            customerId: session.id,
            artisanId,
            status: 'pending',
            deliveryOption,
            totalPrice: Math.max(0, Math.round(subtotal - discount)),
            notes: notes ?? null,
            items: { create: linePayload },
          },
          select: publicCraftOrderSelect,
        });
        orders.push(order);

        // HIRFA Phase 3: burn the coupon slot atomically. The conditional
        // update (usedCount < usageLimit) is what makes two customers racing
        // for the last redemption safe — the loser's whole transaction aborts.
        if (couponRow && discount > 0) {
          const where = {
            id: couponRow.id,
            ...(couponRow.usageLimit !== null && couponRow.usageLimit !== undefined
              ? { usedCount: { lt: couponRow.usageLimit } }
              : {}),
          };
          const updated = await tx.coupon.updateMany({ where, data: { usedCount: { increment: 1 } } });
          if (updated.count === 0) throw new Error('couponExhausted');
        }
      }

      // Decrement stock once per product (after every order is created, so a
      // failure between stores rolls the whole transaction back).
      // Made-to-order products have no physical stock, so they are skipped.
      for (const m of merged.values()) {
        const p = stockMap.get(m.productId);
        if (p?.isMadeToOrder) continue;
        await tx.craftProduct.update({ where: { id: m.productId }, data: { stock: { decrement: m.qty } } });
        // HIRFA Phase 3: variant-level stock is decremented independently.
        if (m.variantId) {
          await tx.productVariant.update({ where: { id: m.variantId }, data: { stock: { decrement: m.qty } } });
        }
      }

      return orders;
    });

    // HIRFA (notification center): tell each artisan they have a new
    // order. `o.artisan.id` is the ArtisanProfile id, but notifications
    // target a USER, so the owning user ids are resolved once here (one
    // round trip, not one per order).
    const artisanProfileIds = created.map((o) => o.artisan.id);
    const artisans = artisanProfileIds.length
      ? await db.artisanProfile.findMany({
          where: { id: { in: artisanProfileIds } },
          select: { id: true, userId: true },
        })
      : [];
    const artisanUserId = new Map(artisans.map((a) => [a.id, a.userId]));
    for (const o of created) {
      const artisanOwner = artisanUserId.get(o.artisan.id);
      if (artisanOwner) void notifyArtisanNewOrder(artisanOwner, o);
    }
    return NextResponse.json({ orders: created }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'productNotFound') return NextResponse.json({ error: 'productNotFound' }, { status: 400 });
    if (msg === 'invalidVariant') return NextResponse.json({ error: 'invalidVariant' }, { status: 400 });
    if (msg === 'insufficientStock') return NextResponse.json({ error: 'insufficientStock' }, { status: 409 });
    // HIRFA Phase 3: coupon error sentinels. 404 for an unknown code, 409 for
    // a code that exists but cannot be used right now (expired / exhausted),
    // 400 for a malformed type the client should never have sent.
    if (msg === 'couponNotFound') return NextResponse.json({ error: 'couponNotFound' }, { status: 404 });
    if (msg === 'couponExpired') return NextResponse.json({ error: 'couponExpired' }, { status: 409 });
    if (msg === 'couponExhausted') return NextResponse.json({ error: 'couponExhausted' }, { status: 409 });
    if (msg === 'couponInvalid') return NextResponse.json({ error: 'couponInvalid' }, { status: 400 });
    return NextResponse.json({ error: 'serverError', detail: msg }, { status: 500 });
  }
}

// GET /api/craft/orders
// Customer: returns their own orders.
// Artisan: returns orders for their shop.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const where =
      session.role === 'artisan'
        ? { artisan: { userId: session.id } }
        : { customerId: session.id };

    const orders = await db.craftOrder.findMany({
      where,
      select: publicCraftOrderSelect,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ orders, total: orders.length });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

function generateOrderCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `HIRFA-${code}`;
}

// Fire-and-forget in-app notification for the artisan: it must never block
// the customer's checkout response. Push (FCM) is still a future addition;
// the notification-center row is the durable, always-delivered path.
//
// CUSTOM MESSAGE (Phase 4): the body names the first product and the buyer,
// so the artisan can triage the order without opening the store view. When
// neither is resolvable the message degrades to the original generic text.
async function notifyArtisanNewOrder(
  userId: string,
  order: Prisma.CraftOrderGetPayload<{ select: typeof publicCraftOrderSelect }>
) {
  try {
    const first = order.items?.[0];
    const productName = first?.product?.nameAr ?? '';
    const customerName = order.customer?.name ?? '';
    const named = productName && customerName;

    const title = 'لديك طلب جديد';
    const body = named
      ? `لديك طلب جديد على "${productName}" من ${customerName}.`
      : 'تحقق من متجرك';

    await createNotification({
      userId,
      type: 'craft_order',
      title,
      body,
      data: {
        orderId: order.id,
        code: order.code,
        i18n: {
          titleKey: 'newCraftOrder',
          bodyKey: named ? 'newCraftOrderProductBody' : 'newCraftOrderBody',
          ...(named
            ? { params: { product: productName, customer: customerName, code: order.code } }
            : {}),
        },
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[craft/orders] artisan notification failed:', e);
  }
}
