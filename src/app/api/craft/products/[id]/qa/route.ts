// HIRFA Phase 3 — POST /api/craft/products/[id]/qa
//
// Any logged-in user can ask a public question about a product. The question
// is visible to every shopper (answered or not), so it must carry no PII
// beyond the asker's public name — hence the `select` on the created row.
//
// SECURITY: the product must exist and belong to an ACTIVE store. There is no
// ownership requirement to ASK (buyers are not yet customers of this artisan),
// but the session is mandatory — anonymous QA would be a spam vector.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

const qaSchema = z.object({
  question: z.string().trim().min(3, 'tooShort').max(500, 'tooLong'),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = qaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }

    // The product must be live (active product in an active store) — a question
    // on a hidden product is pointless and would leak its existence.
    const product = await db.craftProduct.findFirst({
      where: { id, isActive: true, artisan: { status: 'active' } },
      select: { id: true, artisanId: true },
    });
    if (!product) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    const created = await db.productQA.create({
      data: { productId: product.id, userId: session.id, question: parsed.data.question },
      select: {
        id: true,
        productId: true,
        question: true,
        answer: true,
        createdAt: true,
        answeredAt: true,
        user: { select: { id: true, name: true, avatar: true } },
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

// GET /api/craft/products/[id]/qa
// Public list of questions & answers for a product (newest first). The answer
// is null while the artisan has not replied yet.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const qa = await db.productQA.findMany({
      where: { productId: id },
      orderBy: [{ answeredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        productId: true,
        question: true,
        answer: true,
        createdAt: true,
        answeredAt: true,
        user: { select: { id: true, name: true, avatar: true } },
      },
    });
    return NextResponse.json({ qa });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
