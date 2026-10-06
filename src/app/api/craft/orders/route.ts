import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import {
  publicCraftOrderSelect,
  craftDeliverySelectNoAddress,
  aliasDelivery,
  aliasDeliveries,
} from '@/lib/dto';
import { createNotification } from '@/lib/notifications';
// HIRFA Phase 3: server-authoritative pricing (variants / tiers / coupons).
import { couponDiscount, pickTier, unitPriceFor } from '@/lib/craft-pricing';
import { createCraftDeliveryOrder } from '@/lib/craft-delivery';
import { publicProductGate } from '@/lib/marketplace-moderation';
import { fanOutNewOrder, findAvailableDrivers } from '@/lib/dispatch';
import { emitOrderNewRequest } from '@/lib/pusher-server';
import { rateLimit } from '@/lib/rate-limit';

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
  // PHASE 7A: 'wassilha_delivery' creates a real Wassilha transport Order at
  // checkout. Backward compatible: anything omitted still defaults to 'pickup'.
  deliveryOption: z.enum(['pickup', 'wassilha_delivery']).default('pickup'),
  // PHASE 7A: the delivery destination belongs to the CUSTOMER and is captured
  // here, where the customer is present. It is never persisted on CraftOrder
  // (that would expose the customer's home address to the seller) — it goes
  // straight onto the transport Order, where Phase 5 privacy already confines
  // it to the assigned driver / customer / admin.
  dropoffAddress: z.string().trim().min(2).max(200).optional().nullable(),
  dropoffLat: z.number().min(-90).max(90).optional().nullable(),
  dropoffLng: z.number().min(-180).max(180).optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  // HIRFA Phase 3: optional discount code. Validated (and redeemed) only
  // after the server resolved the subtotal — the client never tells us how
  // much the discount is.
  couponCode: z.string().trim().min(2).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    // PHASE 8: per-user cap on this mutation. Placed AFTER the auth + role gate
    // on purpose so an unauthenticated caller is rejected with 401 first, and
    // the bucket is keyed on the session id, which is server-derived and cannot
    // be spoofed by the client.
    const rl = await rateLimit(`craftorder:${session.id}`, 15, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      );
    }


  try {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }

    const { items, deliveryOption, notes, couponCode } = parsed.data;
    // PHASE 7A: a delivery order REQUIRES a destination. We refuse the checkout
    // rather than inventing an address or silently downgrading to pickup — the
    // customer asked for delivery and would otherwise never receive it.
    const wantsDelivery = deliveryOption === 'wassilha_delivery';
    const dropoffAddress =
      typeof parsed.data.dropoffAddress === 'string' ? parsed.data.dropoffAddress.trim() : '';
    if (wantsDelivery && dropoffAddress.length < 2) {
      return NextResponse.json({ error: 'deliveryAddressRequired' }, { status: 400 });
    }

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
    const { orders: created, deliveries } = await db.$transaction(async (tx) => {
      const products = await tx.craftProduct.findMany({
        // PHASE 9: an unapproved/suspended product can no longer be CHECKED OUT
        // either. Hiding it from the storefront is not enough — a stale client
        // cart still holds the id — so the gate is re-asserted here, inside the
        // transaction. Any miss throws productNotFound below, which aborts the
        // ENTIRE checkout rather than creating a partial order.
        where: { id: { in: productIds }, isActive: true, ...publicProductGate, artisan: { status: 'active' } },
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
      // PHASE 7A: the transport Orders created in this transaction, fanned out
      // to drivers AFTER it commits (never inside it).
      const deliveries: { id: string; code: string }[] = [];
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

        // PHASE 7A: create the linked Wassilha transport Order for THIS store.
        // A multi-store cart produces one CraftOrder (and therefore one pickup)
        // per seller, so each gets its own delivery leg - exactly how the goods
        // would physically travel. Inside the SAME transaction as the
        // CraftOrder, which is what makes checkout + delivery atomic.
        if (wantsDelivery) {
          const delivery = await createCraftDeliveryOrder({
            tx,
            craftOrderId: order.id,
            craftOrderCode: order.code,
            customerId: session.id,
            storeId: artisanId,
            dropoffAddress,
            dropoffLat: parsed.data.dropoffLat ?? null,
            dropoffLng: parsed.data.dropoffLng ?? null,
          });
          if (delivery) {
            deliveries.push(delivery);

            // PHASE 7B-01: re-read so the RESPONSE reflects the link written
            // above. The row returned by `craftOrder.create()` was selected
            // BEFORE `createCraftDeliveryOrder()` linked the transport Order,
            // so it still carried `deliveryOrderId: null`. The database was
            // always correct — only the checkout payload was stale. Re-reading
            // inside the same transaction keeps the response consistent with
            // what was committed.
            //
            // Only done when a delivery was actually created, so a plain
            // pickup order returns exactly the same object as before.
            const linked = await tx.craftOrder.findUnique({
              where: { id: order.id },
              select: publicCraftOrderSelect,
            });
            if (linked) {
              const idx = orders.findIndex((o) => o.id === order.id);
              if (idx !== -1) orders[idx] = linked;
            }
          }
        }

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

      return { orders, deliveries };
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
    // PHASE 7A — hand each new delivery to the EXISTING Wassilha dispatch path.
    // We do NOT fan out drivers ourselves: `fanOutNewOrder()` +
    // `emitOrderNewRequest()` are the authoritative Phase 1-6 functions, so the
    // request automatically inherits account-state gating, service type,
    // `isVehicleCompatible()`, large-cargo rules, push, in-app notifications and
    // the Phase 6 realtime event. This runs AFTER the transaction commits, so a
    // rolled-back checkout can never notify a driver.
    for (const delivery of deliveries) {
      try {
        const order = await db.order.findUnique({
          where: { id: delivery.id },
          select: {
            id: true, code: true, cargoType: true,
            pickup: true, dropoff: true,
            requiredVehicleType: true, requiredVehicleTypes: true,
            requiredSeats: true,
          },
        });
        if (!order) continue;
        await fanOutNewOrder({
          id: order.id,
          code: order.code,
          cargoType: order.cargoType,
          pickup: order.pickup,
          dropoff: order.dropoff,
          requiredVehicleType: order.requiredVehicleType ?? null,
          requiredSeats: order.requiredSeats ?? null,
          requiredVehicleTypes: order.requiredVehicleTypes ?? [],
        });
        emitOrderNewRequest(
          order,
          // All four arguments, so the realtime pool matches the push pool
          // exactly (the multi-select field is part of the filter).
          await findAvailableDrivers(
            order.cargoType,
            order.requiredVehicleType ?? null,
            order.requiredSeats ?? null,
            order.requiredVehicleTypes ?? [],
          ),
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[craft/orders] delivery fan-out failed:', e);
      }
    }

    return NextResponse.json({ orders: aliasDeliveries(created) }, { status: 201 });
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
    // PHASE 7A sentinels. All abort the WHOLE transaction (checkout included),
    // so a failed delivery never leaves an orphaned CraftOrder behind.
    if (msg === 'storeNotFound') return NextResponse.json({ error: 'storeNotFound' }, { status: 409 });
    if (msg === 'deliveryLinkLost') return NextResponse.json({ error: 'duplicateSubmit' }, { status: 409 });
    if (msg === 'codeGenFailed') return NextResponse.json({ error: 'serverError' }, { status: 500 });
    return NextResponse.json({ error: 'serverError', detail: msg }, { status: 500 });
  }
}

// GET /api/craft/orders
// Customer: returns their own orders.
// Artisan: returns orders for their shop.
//
// PHASE 7B: each row now carries a nested `delivery` block (the linked
// Wassilha transport Order) so the customer can follow the delivery without a
// second request. It is ONE extra join on the query that was already running —
// no N+1, no new endpoint.
//
// AUTHORIZATION (unchanged): the rows are still scoped by the session —
// `customerId = session.id`, or the artisan's own shop. A customer therefore
// only ever receives deliveries attached to their OWN CraftOrders; there is no
// path by which one customer reads another's delivery.
//
// PRIVACY: the seller branch swaps in `craftDeliverySelectNoAddress`, so a shop
// sees that a delivery exists and how far along it is, but never the buyer's
// pickup/dropoff address. See dto.ts for why.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const isArtisan = session.role === 'artisan';
    const where = isArtisan
      ? { artisan: { userId: session.id } }
      : { customerId: session.id };

    const orders = await db.craftOrder.findMany({
      where,
      select: isArtisan
        ? { ...publicCraftOrderSelect, deliveryOrder: { select: craftDeliverySelectNoAddress } }
        : publicCraftOrderSelect,
      orderBy: { createdAt: 'desc' },
    });

    // `deliveryOrder` (Prisma relation) -> `delivery` (public wire key).
    return NextResponse.json({ orders: aliasDeliveries(orders), total: orders.length });
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

    const title = 'طلب جديد على منتجاتك';
    const body = named
      ? `لديك طلب جديد على ${productName} من ${customerName}. يرجى التأكيد.`
      : 'تحقق من متجرك';

    await createNotification({
      userId,
      // NOTIFICATIONS (Phase 11): typed as 'new_craft_order' so the artisan's
      // bell can badge incoming marketplace orders distinctly.
      type: 'new_craft_order',
      title,
      body,
      data: {
        orderId: order.id,
        code: order.code,
        productId: first?.product?.id ?? undefined,
        customerId: order.customer?.id ?? undefined,
        i18n: {
          titleKey: 'newCraftOrderTitle',
          bodyKey: named ? 'newCraftOrderBody2' : 'newCraftOrderBody',
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
