import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { publicCraftOrderSelect, publicOrderSelect, aliasDelivery } from '@/lib/dto';
import { emitOrderStatus } from '@/lib/pusher-server';
import { createNotification } from '@/lib/notifications';

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
//
// When status transitions to 'ready' and deliveryOption = 'wassilha_delivery',
// a delivery Order is automatically created and linked via deliveryOrderId.
const transitionSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'ready', 'delivered', 'cancelled']),
  // Optional: customer dropoff address for wassilha_delivery
  dropoffAddress: z.string().min(2).max(200).optional(),
  dropoffLat: z.number().min(-90).max(90).optional(),
  dropoffLng: z.number().min(-180).max(180).optional(),
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
      return NextResponse.json(current ? aliasDelivery(current) : current);
    }

    // NOTIFICATIONS (Phase 11) — ORDER ACCEPTED for craft orders.
    //
    // When the ARTISAN confirms the order (pending -> confirmed), the customer
    // gets the same "your order was accepted" surface the taxi/cargo flow
    // delivers at /api/orders/:id/accept: one in-app row typed
    // 'order_accepted' carrying the artisan's display name, so the bell names
    // WHO confirmed. Fire-and-forget AFTER the transition committed: a
    // notification outage must never fail (or duplicate) the status change —
    // the updateMany above is the single source of truth.
    if (newStatus === 'confirmed' && roleForCheck === 'artisan') {
      void notifyCustomerOrderAccepted(order.customerId, order.id).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[craft/status] order-accepted notification failed:', e);
      });
    }

    // PHASE 7A — CANCEL PROPAGATION.
    // Cancelling a marketplace order must also cancel its Wassilha delivery
    // leg, otherwise the transport Order stays `searching` and keeps
    // broadcasting to drivers for goods that will never be dispatched. The
    // conditional update re-asserts "still open" under the row lock, so it can
    // never clobber a delivery that a driver already picked up or completed.
    // A `cancelled` delivery is terminal, so the emit is a courtesy refresh.
    if (newStatus === 'cancelled') {
      const linked = await db.craftOrder.findUnique({
        where: { id },
        select: { deliveryOrderId: true },
      });
      if (linked?.deliveryOrderId) {
        try {
          const stop = await db.order.updateMany({
            where: {
              id: linked.deliveryOrderId,
              status: { in: ['searching', 'scheduled', 'accepted'] },
            },
            data: { status: 'cancelled', cancelledAt: new Date() },
          });
          if (stop.count > 0) {
            const fresh = await db.order.findUnique({
              where: { id: linked.deliveryOrderId },
              select: { ...publicOrderSelect },
            });
            if (fresh) emitOrderStatus(fresh);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[craft/status] delivery cancel failed:', e);
        }
      }
    }

    // PHASE 7A: the old inline "auto-create a delivery Order when the seller
    // marks the craft order ready" block was REMOVED, not revived. It was
    // unreachable (the checkout schema only accepted 'pickup') and unsafe on
    // every axis: hardcoded price 300 / weight 5, a `cargoType` of 'craft', no
    // `isVehicleCompatible()` filter (it pinged EVERY cargo driver), no realtime
    // event, no in-app notification, and a non-transactional
    // read-then-write that could create duplicate delivery Orders under a race.
    //
    // Delivery now happens once, atomically, at checkout via
    // `createCraftDeliveryOrder()` (src/lib/craft-delivery.ts), and the request
    // is dispatched by the existing `fanOutNewOrder()` / `emitOrderNewRequest()`
    // so it inherits all of Phase 1-6. Nothing to do here for 'ready'.

    const result = await db.craftOrder.findUnique({
      where: { id },
      select: publicCraftOrderSelect,
    });

    // PHASE 7B: same `deliveryOrder` -> `delivery` alias as the list/checkout
    // responses, so every craft-order payload has the same shape.
    return NextResponse.json(result ? aliasDelivery(result) : result);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

// Fire-and-forget "order accepted" row for the craft customer (Phase 11).
// Resolves the confirming artisan's display name (falling back to a generic
// copy when none exists) and writes one notification through the single
// createNotification() write path. Never throws.
async function notifyCustomerOrderAccepted(
  customerId: string,
  orderId: string,
): Promise<void> {
  try {
    const order = await db.craftOrder.findUnique({
      where: { id: orderId },
      select: { code: true, artisan: { select: { displayName: true } } },
    });
    if (!order) return;

    const providerName = order.artisan?.displayName ?? '';
    const title = 'تم قبول طلبك!';
    const body = providerName
      ? `تم قبول طلبك من قبل ${providerName}. جارٍ تجهيز طلبك الآن.`
      : 'تم قبول طلبك. جارٍ تجهيز طلبك الآن.';

    await createNotification({
      userId: customerId,
      type: 'order_accepted',
      title,
      body,
      data: {
        orderId,
        code: order.code,
        ...(providerName ? { artisanName: providerName } : {}),
        i18n: {
          titleKey: 'orderAcceptedTitle',
          bodyKey: 'orderAcceptedBody',
          ...(providerName ? { params: { provider: providerName } } : {}),
        },
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[craft/status] order-accepted row failed:', e);
  }
}
