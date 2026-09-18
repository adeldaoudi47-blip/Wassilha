import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { publicCraftOrderSelect } from '@/lib/dto';

// POST /api/craft/orders
// Customer-only. Creates a craft order from the client-side cart.
//
// SECURITY (OWASP V7 — price tampering):
//   - totalPrice is ALWAYS computed server-side from CraftProduct.price
//     (the DB value, never the client-submitted price).
//   - Stock is checked AND decremented inside a transaction to prevent
//     race conditions (two customers buying the last item simultaneously).
const createSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(100),
      })
    )
    .min(1, 'emptyCart')
    .max(50, 'tooManyItems'),
  deliveryOption: z.enum(['pickup']).default('pickup'),
  notes: z.string().trim().max(500).optional(),
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

    const { items, deliveryOption, notes } = parsed.data;

    // Deduplicate items (same productId merged into one line with summed qty)
    const merged = new Map<string, number>();
    for (const it of items) {
      merged.set(it.productId, (merged.get(it.productId) || 0) + it.quantity);
    }
    const productIds = Array.from(merged.keys());

    // Transaction: verify stock, create order(s), decrement stock.
    //
    // HIRFA Phase 2B: the public cart may legitimately hold products from
    // SEVERAL stores. A CraftOrder belongs to ONE artisan (the schema models a
    // single artisanId per order), so items are grouped by their owning artisan
    // and ONE order is created per store. Before this, a multi-store checkout
    // attributed the whole cart to the FIRST product's artisan: the other
    // seller's stock was decremented but they never saw the order. Everything
    // stays inside one transaction, so a failure leaves no partial state.
    const created = await db.$transaction(async (tx) => {
      const products = await tx.craftProduct.findMany({
        where: { id: { in: productIds }, isActive: true, artisan: { status: 'active' } },
        select: { id: true, price: true, stock: true, artisanId: true, nameAr: true },
      });

      if (products.length !== productIds.length) throw new Error('productNotFound');

      const stockMap = new Map(products.map((p) => [p.id, p]));
      for (const [pid, qty] of merged) {
        const product = stockMap.get(pid);
        if (!product || product.stock < qty) throw new Error('insufficientStock');
      }

      // Group line items by the artisan who actually owns each product.
      const byArtisan = new Map<string, Map<string, number>>();
      for (const [pid, qty] of merged) {
        const owner = stockMap.get(pid)!.artisanId;
        if (!byArtisan.has(owner)) byArtisan.set(owner, new Map());
        byArtisan.get(owner)!.set(pid, qty);
      }

      const orders: Prisma.CraftOrderGetPayload<{ select: typeof publicCraftOrderSelect }>[] = [];
      for (const [artisanId, lineItems] of byArtisan) {
        // Compute totalPrice server-side from DB prices for THIS store only.
        let totalPrice = 0;
        for (const [pid, qty] of lineItems) totalPrice += stockMap.get(pid)!.price * qty;

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
            totalPrice: Math.round(totalPrice),
            notes: notes ?? null,
            items: {
              create: Array.from(lineItems).map(([pid, qty]) => ({
                productId: pid,
                quantity: qty,
                unitPrice: stockMap.get(pid)!.price,
              })),
            },
          },
          select: publicCraftOrderSelect,
        });
        orders.push(order);
      }

      // Decrement stock once per product (after every order is created, so a
      // failure between stores rolls the whole transaction back).
      for (const [pid, qty] of merged) {
        await tx.craftProduct.update({ where: { id: pid }, data: { stock: { decrement: qty } } });
      }

      return orders;
    });

    for (const o of created) void notifyArtisanNewOrder(o.artisan.id, o.code);
    return NextResponse.json({ orders: created }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'productNotFound') return NextResponse.json({ error: 'productNotFound' }, { status: 400 });
    if (msg === 'insufficientStock') return NextResponse.json({ error: 'insufficientStock' }, { status: 409 });
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

async function notifyArtisanNewOrder(_artisanId: string, _orderCode: string) {
  // Future: FCM push notification
}
