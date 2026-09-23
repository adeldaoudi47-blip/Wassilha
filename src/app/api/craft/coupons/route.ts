// HIRFA Phase 3 — coupon CRUD for the artisan dashboard.
//
// POST   /api/craft/coupons       create a coupon scoped to THIS artisan
// GET    /api/craft/coupons       list the artisan's own coupons
// DELETE /api/craft/coupons/[id]  delete a coupon (never an order's history —
//                                 a redeemed coupon row stays for reporting)
//
// SECURITY: every route goes through requireActiveArtisan and scopes by the
// session's own artisanId. A coupon CODE is a store asset: creating one for
// someone else's shop, or reading/deleting another shop's coupons, is a
// straight IDOR and is blocked at the query level (where: { artisanId }).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'codeTooShort')
    .max(40, 'codeTooLong')
    // Letters, digits, dash, underscore, dot — no spaces, no slashes (the code
    // ends up in URLs / QR codes / WhatsApp shares).
    .regex(/^[A-Za-z0-9._-]+$/, 'codeInvalidChars')
    .transform((c) => c.toUpperCase()),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1).max(100_000_000),
  // Percentage coupons are capped at 100 (a "150% off" coupon is nonsense and
  // would be a refund, not a discount).
  expiresAt: z.string().datetime().optional().nullable(),
  usageLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
}).refine((v) => (v.type === 'percent' ? v.value <= 100 : true), {
  message: 'percentTooHigh',
  path: ['value'],
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

    const created = await db.coupon.create({
      data: {
        artisanId: gate.artisanId,
        code: parsed.data.code,
        type: parsed.data.type,
        value: parsed.data.value,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        usageLimit: parsed.data.usageLimit ?? null,
      },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        expiresAt: true,
        usageLimit: true,
        usedCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    // P2002 = unique constraint violation on `code`: the shop already has a
    // coupon with this exact code (codes are globally unique in the table).
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      return NextResponse.json({ error: 'couponCodeTaken' }, { status: 409 });
    }
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

export async function GET() {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const coupons = await db.coupon.findMany({
      where: { artisanId: gate.artisanId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        expiresAt: true,
        usageLimit: true,
        usedCount: true,
        createdAt: true,
      },
      take: 200,
    });

    return NextResponse.json({ coupons });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
