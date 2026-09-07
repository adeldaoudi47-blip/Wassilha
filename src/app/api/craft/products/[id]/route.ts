import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicCraftProductSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/craft/products/:id
// Public product detail incl. the artisan shop card (display name,
// rating, neighbourhood). Same moderation + PII gates as the list
// endpoint: inactive products and non-active artisans return 404.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const product = await db.craftProduct.findFirst({
      where: { id, isActive: true, artisan: { status: 'active' } },
      select: publicCraftProductSelect,
    });
    if (!product) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
