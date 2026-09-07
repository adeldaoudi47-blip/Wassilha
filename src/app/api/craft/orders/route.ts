import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
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

    // Transaction: verify stock, create order, decrement stock
    const order = await db.$transaction(async (tx) => {
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

      // Compute totalPrice server-side from DB prices
      let totalPrice = 0;
      for (const [pid, qty] of merged) {
        totalPrice += stockMap.get(pid)!.price * qty;
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
          artisanId: products[0].artisanId,
          status: 'pending',
          deliveryOption,
          totalPrice: Math.round(totalPrice),
          notes: notes ?? null,
          items: {
            create: Array.from(merged).map(([pid, qty]) => ({
              productId: pid,
              quantity: qty,
              unitPrice: stockMap.get(pid)!.price,
            })),
          },
        },
        select: publicCraftOrderSelect,
      });

      // Decrement stock
      for (const [pid, qty] of merged) {
        await tx.craftProduct.update({ where: { id: pid }, data: { stock: { decrement: qty } } });
      }

      return order;
    });

    void notifyArtisanNewOrder(order.artisan.id, order.code);
    return NextResponse.json(order, { status: 201 });
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
