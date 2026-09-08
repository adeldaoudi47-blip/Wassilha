import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { publicCraftOrderSelect } from '@/lib/dto';
import { sendPushNotificationBatch } from '@/lib/firebase-admin';
import { generateOrderCode } from '@/lib/wassilha-data';
import { GUERRARA_CENTER } from '@/lib/wassilha-data';

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
      return NextResponse.json(current);
    }

    // P7: Delivery Integration — when status transitions to 'ready' and
    // deliveryOption is 'wassilha_delivery', create a delivery Order.
    if (newStatus === 'ready') {
      const craftOrder = await db.craftOrder.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          deliveryOption: true,
          deliveryOrderId: true,
          customerId: true,
          artisan: {
            select: {
              addressAr: true,
              latitude: true,
              longitude: true,
              area: { select: { nameAr: true } },
            },
          },
        },
      });

      if (craftOrder && craftOrder.deliveryOption === 'wassilha_delivery' && !craftOrder.deliveryOrderId) {
        // Get artisan workshop address as pickup
        const pickupAddress = craftOrder.artisan.addressAr ||
          (craftOrder.artisan.area ? `${craftOrder.artisan.area.nameAr} - القرارة` : 'ورشة الحرفي - القرارة');

        // Get dropoff from request body or use Guerrara center as fallback
        const dropoffAddress = body && typeof body === 'object' && 'dropoffAddress' in body && typeof body.dropoffAddress === 'string'
          ? body.dropoffAddress
          : 'عنوان الزبون - القرارة';

        const artisanLat = craftOrder.artisan.latitude ? Number(craftOrder.artisan.latitude) : GUERRARA_CENTER.lat;
        const artisanLng = craftOrder.artisan.longitude ? Number(craftOrder.artisan.longitude) : GUERRARA_CENTER.lng;
        const dropoffLat = body && typeof body === 'object' && 'dropoffLat' in body && typeof body.dropoffLat === 'number'
          ? body.dropoffLat : GUERRARA_CENTER.lat;
        const dropoffLng = body && typeof body === 'object' && 'dropoffLng' in body && typeof body.dropoffLng === 'number'
          ? body.dropoffLng : GUERRARA_CENTER.lng;

        // Generate order code
        let orderCode = generateOrderCode();
        let attempts = 0;
        while (await db.order.count({ where: { code: orderCode } }) > 0) {
          orderCode = generateOrderCode();
          if (++attempts > 10) break;
        }

        // Create the delivery Order
        const deliveryOrder = await db.order.create({
          data: {
            code: orderCode,
            customerId: craftOrder.customerId,
            cargoType: 'craft', // Distinguish as Hirfa delivery
            pickup: pickupAddress,
            dropoff: dropoffAddress,
            pickupLat: artisanLat,
            pickupLng: artisanLng,
            dropoffLat,
            dropoffLng,
            weight: 5, // Default weight for craft delivery (kg)
            price: 300, // Default price for craft delivery
            status: 'searching',
            notes: `توصيل منتج حِرفة - طلب ${craftOrder.code}`,
          },
        });

        // Link the CraftOrder to the new delivery Order
        await db.craftOrder.update({
          where: { id },
          data: { deliveryOrderId: deliveryOrder.id },
        });

        // Fan-out: notify available drivers about the new craft delivery
        void (async () => {
          try {
            const availableDrivers = await db.driver.findMany({
              where: {
                isOnline: true,
                isVerified: true,
                user: { accountStatus: 'active' },
                OR: [
                  { serviceType: 'BOTH' },
                  { serviceType: 'CARGO' },
                ],
              },
              select: { userId: true },
            });

            if (availableDrivers.length === 0) return;

            await sendPushNotificationBatch(
              availableDrivers.map((d) => d.userId),
              'طلب حِرفة جديد',
              `لديك طلب توصيل منتج حرفي جديد - ${craftOrder.code}`,
              { type: 'new_craft_order', orderId: deliveryOrder.id, craftOrderId: id, orderCode: deliveryOrder.code }
            );
          } catch (e) {
            console.warn('[craft/status] driver fan-out failed:', e);
          }
        })();
      }
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
