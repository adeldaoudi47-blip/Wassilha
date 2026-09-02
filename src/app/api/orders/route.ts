import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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

// OWASP — API3:2023 (Broken Object Property Level Authorization) + API8
// (Security Misconfiguration): strict input validation with Zod. The
// previous hand-rolled type-checks silently accepted any garbage and
// let the route fall through to default coordinates. Zod rejects
// malformed / over-long / wrong-typed values with a single 400 and a
// structured error list, so the client UI can highlight the bad field.
const createOrderSchema = z.object({
  cargoType: z.enum(VALID_CARGO as [CargoKey, ...CargoKey[]], {
    message: 'invalidCargoType',
  }),
  pickup: z
    .string()
    .trim()
    .min(2, 'pickupTooShort')
    .max(200, 'pickupTooLong'),
  dropoff: z
    .string()
    .trim()
    .min(2, 'dropoffTooShort')
    .max(200, 'dropoffTooLong'),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  weight: z.number().min(0).max(50_000).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

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
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      // Surface the FIRST error code so the client can match it against
      // its translation table. The full list is also included for
      // debugging but not used by the UI yet.
      const first = parsed.error.issues[0];
      return NextResponse.json(
        {
          error: first?.message ?? 'invalidBody',
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }
    const data = parsed.data;
    const cargoType = data.cargoType;
    const pickup = data.pickup.trim();
    const dropoff = data.dropoff.trim();

    // SECURITY (V7): the fare is ALWAYS recomputed server-side. We do
    // not read or store any client-supplied price; even if a client
    // sends one, the actual price is derived from the active Pricing
    // row and the pickup/dropoff coordinates. We also recompute
    // distance from the same coordinates so the stored value cannot
    // drift from the fare computation.
    const pickupLat = data.pickupLat;
    const pickupLng = data.pickupLng;
    const dropoffLat = data.dropoffLat;
    const dropoffLng = data.dropoffLng;
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
        pickup,
        dropoff,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        weight:
          typeof data.weight === 'number' && data.weight >= 0
            ? Math.round(data.weight)
            : 20,
        // SECURITY (V7): server-computed; any client-supplied price is
        // ignored. The Prisma Order model has both distance and
        // price columns, so we persist the recomputed values here.
        distance: distanceKm,
        price,
        status: 'searching',
        notes:
          typeof data.notes === 'string' && data.notes.trim()
            ? data.notes.trim()
            : null,

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