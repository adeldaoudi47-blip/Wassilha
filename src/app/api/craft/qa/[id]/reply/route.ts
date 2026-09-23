// HIRFA Phase 3 — PATCH /api/craft/qa/[id]/reply
//
// Only the artisan who OWNS the product the question is about may answer it.
// Answering flips `answeredAt` to now and bumps the question in the list
// (answered QA sorts first). The reply is public text, so it goes through the
// same length limits as a product description.
//
// SECURITY (IDOR): ownership is resolved by joining QA → product → artisanId
// and comparing against the session's artisan profile — the QA id alone is
// never trusted.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

const replySchema = z.object({
  answer: z.string().trim().min(1, 'emptyAnswer').max(1000, 'tooLong'),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }

    // Resolve the question together with the owning artisan of its product —
    // one query, and it doubles as the existence + ownership check.
    const qa = await db.productQA.findUnique({
      where: { id },
      select: { id: true, product: { select: { artisanId: true } } },
    });
    if (!qa) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (qa.product.artisanId !== gate.artisanId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const updated = await db.productQA.update({
      where: { id },
      data: { answer: parsed.data.answer, answeredAt: new Date() },
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

    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
