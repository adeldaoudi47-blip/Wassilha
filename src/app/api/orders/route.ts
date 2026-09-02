import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateOrderCode } from '@/lib/wassilha-data';
import { computeOrderPrice } from '@/lib/pricing';
import { sendPushNotification } from '@/lib/firebase-admin';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';
import type { CargoKey, OrderStatus } from '@/lib/types';

const VALID_CARGO: CargoKey[] = [
  'parcel',
  'goods',
  'shop',
  'furniture',
  'appliance',
  'construction',
  'personal',
  'other',
];

const VALID_STATUS: OrderStatus[] = [
  'searching',
  'accepted',
  'picked',
  'delivered',
  'cancelled',
];

// GET /api/orders?role=&status=
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    // SECURITY: the role is ALWAYS derived from the authenticated session.
    // Client-supplied ?role= is ignored entirely so a customer can never
    // widen their query to another role's data scope.
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;

    const where: any = {};
    if (session.role === 'customer') {
      where.customerId = session.id;
    } else if (session.role === 'driver') {
      where.driverId = session.id;
    }
    // admin -> no customer/driver filter (returns all)
    if (status && VALID_STATUS.includes(status as OrderStatus)) {
      where.status = status;
    }

    const orders = await db.order.findMany({
      where,
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// POST /api/orders  (customer only)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer' && session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const cargoType = body.cargoType;
    if (!VALID_CARGO.includes(cargoType as CargoKey)) {
      return NextResponse.json({ error: 'invalidCargoType' }, { status: 400 });
    }
    if (typeof body.pickup !== 'string' || typeof body.dropoff !== 'string') {
      return NextResponse.json(
        { error: 'invalidLocations' },
        { status: 400 }
      );
    }

    // SECURITY (V7): the fare is ALWAYS recomputed server-side. We do
    // not read or store any ody.price field; even if a client sends
    // one, the actual price is derived from the active Pricing row and
    // the pickup/dropoff coordinates. We also recompute distance from
    // the same coordinates so the stored value cannot drift from the
    // fare computation.
    const pickupLat =
      typeof body.pickupLat === 'number' ? body.pickupLat : 32.7833;
    const pickupLng =
      typeof body.pickupLng === 'number' ? body.pickupLng : 3.7667;
    const dropoffLat =
      typeof body.dropoffLat === 'number' ? body.dropoffLat : 32.79;
    const dropoffLng =
      typeof body.dropoffLng === 'number' ? body.dropoffLng : 3.78;
    const { price, distanceKm } = await computeOrderPrice({
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      cargoType: cargoType as CargoKey,
    });

    const order = await db.order.create({
      data: {
        code: generateOrderCode(),
        customerId: session.id,
        cargoType,
        pickup: body.pickup,
        dropoff: body.dropoff,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        weight:
          typeof body.weight === 'number' && body.weight >= 0
            ? Math.round(body.weight)
            : 20,
        // SECURITY (V7): server-computed; any client-supplied price is
        // ignored. The Prisma Order model has both distance and
        // price columns, so we persist the recomputed values here.
        distance: distanceKm,
        price,
        status: 'searching',
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      },
      select: {
        ...publicOrderSelect,
        customer: { select: publicUserSelect },
        driver: { select: publicUserSelect },
      },
    });

    // Fire-and-forget: notify every online, verified, active driver that
    // a new order is looking for a triporteur. The push helper itself
    // never throws, but we still wrap the fan-out in try/catch so a FCM
    // outage cannot leak an unhandled rejection from this handler.
    void (async () => {
      try {
        const availableDrivers = await db.driver.findMany({
          where: {
            isOnline: true,
            isVerified: true,
            user: { accountStatus: 'active' },
          },
          select: { userId: true },
        });
        for (const d of availableDrivers) {
          void sendPushNotification(
            d.userId,
            'طلب جديد',
            'لديك طلب توصيل جديد، تحقق من التطبيق.',
            { type: 'new_order', orderId: order.id, orderCode: order.code }
          ).catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('[orders] driver push failed:', e);
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[orders] driver fan-out notify failed:', e);
      }
    })();
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
