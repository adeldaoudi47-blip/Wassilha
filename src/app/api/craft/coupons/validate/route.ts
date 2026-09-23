// HIRFA Phase 3 — POST /api/craft/coupons/validate
//
// Preview endpoint: the cart asks "is this code good, and what would it take
// off THIS subtotal?" Nothing is redeemed here — the coupon is only burned
// inside the POST /api/craft/orders transaction. This keeps the UI honest
// (the discount shown is the discount applied) while making it impossible for
// a client to spend a coupon without buying anything.
//
// Body: { code: string, subtotal?: number }
//   - subtotal defaults to 0; a 0 subtotal means "just check the code" and a
//     legitimately valid code with a 0 discount is still reported as valid.
//
// SECURITY: the response leaks only the coupon's type/value and its scope.
// The artisanId is returned so the cart can tell the buyer WHICH store the
// coupon applies to (a multi-store cart only discounts the matching store).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { couponDiscount } from '@/lib/craft-pricing';

const validateSchema = z.object({
  code: z.string().trim().min(2).max(40),
  subtotal: z.number().int().min(0).max(100_000_000).optional(),
});

export async function POST(req: NextRequest) {
  // A session is required: coupon codes are store assets, and an anonymous
  // validate endpoint would let anyone enumerate codes (brute force).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const parsed = validateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }

    const subtotal = parsed.data.subtotal ?? 0;
    const coupon = await db.coupon.findUnique({
      where: { code: parsed.data.code.toUpperCase() },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        artisanId: true,
        expiresAt: true,
        usageLimit: true,
        usedCount: true,
      },
    });

    if (!coupon) return NextResponse.json({ valid: false, error: 'couponNotFound' }, { status: 404 });

    if (coupon.type !== 'percent' && coupon.type !== 'fixed') {
      return NextResponse.json({ valid: false, error: 'couponInvalid' }, { status: 400 });
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return NextResponse.json({ valid: false, error: 'couponExpired' }, { status: 409 });
    }
    if (
      coupon.usageLimit !== null &&
      coupon.usageLimit !== undefined &&
      coupon.usedCount >= coupon.usageLimit
    ) {
      return NextResponse.json({ valid: false, error: 'couponExhausted' }, { status: 409 });
    }

    return NextResponse.json({
      valid: true,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      artisanId: coupon.artisanId,
      discount: couponDiscount(coupon.type, coupon.value, subtotal),
    });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
