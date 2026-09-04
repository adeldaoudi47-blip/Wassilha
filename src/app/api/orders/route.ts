import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateOrderCode, GUERRARA_CENTER } from '@/lib/wassilha-data';
import { computeOrderPrice } from '@/lib/pricing';
import { sendPushNotification, sendPushNotificationBatch } from '@/lib/firebase-admin';
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
  // `taxi` is the passenger-transport service (Yassir-style). It is
  // routed through the same Order table — the `cargoType` column is
  // a free String, so no Prisma migration is required. Adding a
  // string to the array is fully backward-compatible with old rows.
  'taxi',
];

const VALID_STATUS: OrderStatus[] = [
  'searching',
  // `scheduled` is accepted on read (filtering / listing) but is
  // never accepted on a direct POST / PUT from the client — the
  // server derives it from `scheduledAt` instead, to prevent
  // clients from spoofing the lifecycle state.
  'scheduled',
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
  // OWASP API3 (BOPLA) -- defensive nullable coords. The customer-home
  // UI allows free-text addresses (no map pin), in which case the
  // client omits the coord fields entirely. We still want to reject
  // out-of-range numeric values, so we keep the .min/.max bounds but
  // allow `null` (legacy clients) and `undefined` (omitted). Server-

  // side fallback to GUERRARA_CENTER is applied below, *after* parsing.
  pickupLat: z.number().min(-90).max(90).nullable().optional(),
  pickupLng: z.number().min(-180).max(180).nullable().optional(),
  dropoffLat: z.number().min(-90).max(90).nullable().optional(),
  dropoffLng: z.number().min(-180).max(180).nullable().optional(),
  weight: z.number().min(0).max(50_000).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  // SCHEDULED BOOKINGS: optional ISO-8601 timestamp. The server
  // parses it once via `new Date()` so the client can send either
  // an ISO string or a millisecond epoch. The route handler then
  // decides whether the order is immediate or scheduled based on
  // whether the parsed timestamp is in the future. Past dates are
  // silently coerced to `null` (immediate order) so a stale UI
  // doesn't accidentally book a ride in the past.
  scheduledAt: z
    .union([z.string(), z.number(), z.date()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return null;
      const d = v instanceof Date ? v : new Date(v);
      if (!Number.isFinite(d.getTime())) return null;
      // Past dates are treated as "no scheduling" so the customer
      // gets an immediate order instead of a confusing 400.
      if (d.getTime() <= Date.now()) return null;
      return d;
    }),
});

// GET /api/orders?role=&status=
// Resolve a coord field that may be `null` (legacy client) or
// `undefined` (omitted because the customer typed the address as
// free text). Both cases fall back to the El Guerrara centroid so
// the order can be created with a sane (lat, lng) pair. The Prisma
// `Order.pickupLat` column is non-nullable with a default centroid,
// so persisting `null` would otherwise throw a PrismaClientValidationError.
//
// SECURITY: this is a *display* fallback only -- it does NOT
// silently coerce out-of-range numerics, because Zod already
// rejected those at the schema layer with a 400.

function resolveCoord(
  value: number | null | undefined,
  axis: 'lat' | 'lng',
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return axis === 'lat' ? GUERRARA_CENTER.lat : GUERRARA_CENTER.lng;
}
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
    // Apply the centroid fallback for free-text addresses. Zod has
    // already rejected out-of-range numerics, so any surviving
    // value is either a valid number or null/undefined (free text).
    const pickupLat = resolveCoord(data.pickupLat, 'lat');
    const pickupLng = resolveCoord(data.pickupLng, 'lng');
    const dropoffLat = resolveCoord(data.dropoffLat, 'lat');
    const dropoffLng = resolveCoord(data.dropoffLng, 'lng');
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
        // SCHEDULED BOOKINGS: when `scheduledAt` is a future date
        // (validated by Zod above), the order waits in `scheduled`
        // state and the driver fan-out below is skipped. The
        // dispatcher (or a cron-like job, out of scope here) flips
        // the status to `searching` when the time approaches.
        // A null `scheduledAt` (or a past date) keeps the legacy
        // immediate flow with `status='searching'`.
        status: data.scheduledAt ? 'scheduled' : 'searching',
        scheduledAt: data.scheduledAt ?? null,
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
    //
    // Service-type filter (V2): drivers opt into the kinds of orders
    // they want to receive by setting `Driver.serviceType` to one of
    // "CARGO" / "TAXI" / "BOTH" at registration time. The fan-out
    // below translates the order's cargoType into the requested
    // service category ("taxi" -> "TAXI", everything else -> "CARGO")
    // and then matches on `serviceType IN { "BOTH", requested }`.
    // A cargo-only driver therefore never receives a taxi ping, and
    // a taxi-only driver never receives a cargo ping. The compound
    // index @@index([isOnline, isVerified, serviceType]) keeps the
    // query cheap as the fleet grows.
    void (async () => {
      // SCHEDULED BOOKINGS: skip the driver fan-out for future-dated
      // orders. The order is stored in `status='scheduled'` and
      // waits in the "incoming scheduled" tab on the driver side.
      // When the dispatcher flips it to `searching`, the normal
      // fan-out (this whole block) runs from that path instead.
      if (data.scheduledAt) return;
      try {
        // Map Order.cargoType to the Driver.serviceType category the
        // order is requesting. The Order column is a free String so
        // an unknown cargo value (e.g. a future "HEAVY") still falls
        // through to the cargo fan-out rather than blowing up here.
        const requestedService: 'CARGO' | 'TAXI' =
          cargoType === 'taxi' ? 'TAXI' : 'CARGO';
        const availableDrivers = await db.driver.findMany({
          where: {
            isOnline: true,
            isVerified: true,
            user: { accountStatus: 'active' },
            // The `OR` shape lets a single Prisma query hit both the
            // specialists (serviceType = requestedService) and the
            // generalists (serviceType = "BOTH"). A driver whose
            // serviceType is the *opposite* of the requested one is
            // excluded automatically.
            OR: [
              { serviceType: 'BOTH' },
              { serviceType: requestedService },
            ],
          },
          select: { userId: true },
        });
        if (availableDrivers.length === 0) return;
        // One Prisma call + one FCM call regardless of fleet size.
        // The batch helper also handles the 5s timeout and dead-token
        // pruning internally.
        void sendPushNotificationBatch(
          availableDrivers.map((d) => d.userId),
          'طلب جديد',
          'لديك طلب توصيل جديد، تحقق من التطبيق.',
          { type: 'new_order', orderId: order.id, orderCode: order.code }
        ).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[orders] driver push batch failed:', e);
        });
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