import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { orderOfferSelect, publicUserSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string; offerId: string }> };

// PRICE NEGOTIATION (Phase 3) — POST /api/orders/:id/offers/:offerId/reject
// (customer only)
//
// The customer declines one driver's price. Unlike /accept this never
// touches the Order row: the order stays `searching` so the remaining
// drivers' offers stay live and the customer can keep comparing.
//
// SECURITY: the guard is on ownership (the offer's order must belong to the
// calling customer) AND on state (only a `pending` offer can be rejected —
// rejecting an already-accepted offer would not un-assign the order).
// `updateMany` with those preconditions is atomic, so a double-tap or a
// race with /accept can never flip an accepted offer back.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id, offerId } = await params;

    // Resolve the offer first (with its parent order) so we can check
    // ownership and current state before writing anything.
    const offer = await db.orderOffer.findUnique({
      where: { id: offerId },
      select: {
        ...orderOfferSelect,
        driver: { select: publicUserSelect },
        order: { select: { id: true, customerId: true } },
      },
    });
    if (!offer) {
      return NextResponse.json({ error: 'offerNotFound' }, { status: 404 });
    }
    // The offer must belong to the order in the URL; a mismatch is a client
    // bug or an attempt to act on another customer's order.
    if (offer.orderId !== id) {
      return NextResponse.json({ error: 'offerNotForOrder' }, { status: 400 });
    }
    if (offer.order.customerId !== session.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (offer.status !== 'pending') {
      return NextResponse.json({ error: 'offerNotPending' }, { status: 409 });
    }

    await db.orderOffer.updateMany({
      where: { id: offer.id, status: 'pending' },
      data: { status: 'rejected' },
    });

    // Re-read so the response reflects the settled row.
    const settled = await db.orderOffer.findUnique({
      where: { id: offer.id },
      select: { ...orderOfferSelect, driver: { select: publicUserSelect } },
    });
    return NextResponse.json(settled ?? offer);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
