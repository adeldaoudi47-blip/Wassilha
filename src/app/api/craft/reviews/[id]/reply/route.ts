// HIRFA Phase 3 — PATCH /api/craft/reviews/[id]/reply
//
// The artisan's public reply to a review (sellerReply). Only the artisan who
// RECEIVED the review may reply — the review is on their shop, so the reply is
// the shop owner's voice in the conversation.
//
// SECURITY (IDOR): the review row carries `toId` (the ArtisanProfile that was
// rated). We compare it against the caller's own artisan id; a shop owner can
// never reply to a review left on another shop.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

const replySchema = z.object({
  reply: z.string().trim().min(1, 'emptyReply').max(1000, 'tooLong'),
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

    const review = await db.craftReview.findUnique({
      where: { id },
      select: { id: true, toId: true, images: true, sellerReply: true },
    });
    if (!review) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    // IDOR guard: only the shop the review was addressed to can reply to it.
    if (review.toId !== gate.artisanId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    await db.craftReview.update({
      where: { id },
      data: { sellerReply: parsed.data.reply },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, sellerReply: parsed.data.reply });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
