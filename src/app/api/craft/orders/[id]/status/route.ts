import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { publicCraftOrderSelect } from '@/lib/dto';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/craft/orders/[id]/status
// Race-safe status transition. Only the artisan (who owns the order) or
// the customer (who placed it) may change status, and only along valid
// transitions:
//
//   pending   -> confirmed  (artisan accepts)
//   pending   -> cancelled  (customer cancels OR artisan rejects)
//   confirmed -> ready      (artisan marks product ready)
//   ready     -> delivered  (customer picks up / receives)
//   ready     -> cancelled  (customer cancels after confirmation)
const transitionSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'ready', 'delivered', 'cancelled']),
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

// Who is allowed to trigger which transition?
function canTransition(role: string, from: string, to: string): boolean {
  if (to === 'cancelled') {
    if (role === 'customer') return ['pending', 'confirmed', 'ready'].includes(from);
    if (role === 'artisan') return from === 'pending';
  }
  if (role === 'artisan') {
    if (to === 'confirmed' && from === 'pending') return true;
    if (to === 'ready' && from === 'confirmed') return true;
  }
  if (role === 'customer' && to === 'delivered' && from === 'ready') return true;
  return false;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput' }, { status: 400 });
    }

    const { status: newStatus } = parsed.data;

    // Fetch the order and verify ownership
    const order = await db.craftOrder.findUnique({
      where: { id },
      select: { id: true, status: true, customerId: true, artisanId: true },
    });
    if (!order) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    const isOwner =
      order.customerId === session.id ||
      (session.role === 'artisan' && false); // artisan check via artisanId below

    // For artisan, verify the artisan profile matches
    let artisanMatches = false;
    if (session.role === 'artisan') {
      const artisan = await db.artisanProfile.findUnique({
        where: { userId: session.id },
        select: { id: true },
      });
      artisanMatches = artisan?.id === order.artisanId;
    }

    if (!isOwner && !artisanMatches) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Validate the transition
    const currentStatus = order.status;
    const validTargets = VALID_TRANSITIONS[currentStatus] || [];
    if (!validTargets.includes(newStatus)) {
      return NextResponse.json({ error: 'invalidTransition' }, { status: 409 });
    }

    // Verify permission for this specific transition
    const roleForCheck = artisanMatches ? 'artisan' : 'customer';
    if (!canTransition(roleForCheck, currentStatus, newStatus)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Determine which timestamp field to set
    const timestampFields: Record<string, string> = {
      confirmed: 'confirmedAt',
      ready: 'readyAt',
      delivered: 'deliveredAt',
      cancelled: 'cancelledAt',
    };
    const tsField = timestampFields[newStatus];

    // Race-safe update: WHERE clause includes the current status so concurrent
    // PATCHes cannot double-transition (only one will match).
    const updated = await db.craftOrder.updateMany({
      where: { id, status: currentStatus },
      data: {
        status: newStatus,
        ...(tsField ? { [tsField]: new Date() } : {}),
      },
    });

    if (updated.count === 0) {
      // Another request transitioned it first — refetch and return current state
      const current = await db.craftOrder.findUnique({
        where: { id },
        select: publicCraftOrderSelect,
      });
      return NextResponse.json(current);
    }

    const result = await db.craftOrder.findUnique({
      where: { id },
      select: publicCraftOrderSelect,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
