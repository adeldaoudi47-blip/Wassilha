import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateOrderCode, GUERRARA_CENTER } from '@/lib/wassilha-data';
import { computeOrderPrice } from '@/lib/pricing';
import { publicUserSelect, publicOrderSelect } from '@/lib/dto';
import { fanOutNewOrder, findAvailableDrivers } from '@/lib/dispatch';
import { emitOrderNewRequest } from '@/lib/pusher-server';
import type { CargoKey, OrderStatus, OfficialVehicleCategory } from '@/lib/types';
import {
  VEHICLE_CATEGORIES,
  OFFICIAL_VEHICLE_CATEGORIES,
  isVehicleCategory,
  normalizeVehicleCategory,
  validateRequiredVehicleTypes,
  vehicleCategorySide,
  CARGO_SIZE_WEIGHT,
} from '@/lib/types';
import { isAllowedCargoImageUrl } from '@/lib/offer-policy';
import { serviceCategoryFor } from '@/lib/dispatch';
import { rateLimit } from '@/lib/rate-limit';

/**
 * C7 — retry a Prisma write that can fail with `P2002` (unique-constraint
 * collision). `generateOrderCode()` now draws from a ~2^40 space, so a
 * collision is effectively unreachable — but regenerating + retrying costs
 * nothing and guarantees a booking can never 500 on a rare collision.
 * The factory callback (rather than pre-built args) is what lets Prisma
 * infer the exact `select`-narrowed return type at the call site.
 */
async function retryOnUniqueViolation<T>(
  factory: () => Promise<T>,
  regenerate: () => void,
  maxAttempts = 4,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await factory();
    } catch (err) {
      if (attempt < maxAttempts - 1 && (err as { code?: string } | null)?.code === 'P2002') {
        regenerate();
        continue;
      }
      throw err;
    }
  }
}


const VALID_CARGO: CargoKey[] = [
  'parcel',
  'goods',
  'shop',
  'furniture',
  'appliance',
  'construction',
  'personal',
  // CARGO DEDICATED FLOW (Phase 4): restaurant / food delivery.
  'food',
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
  // VEHICLE-TYPE MATCHING (Phase 2): the customer may require a specific
  // vehicle category. We validate the string shape here (so an over-long
  // or non-string value 400s cleanly) and the *vocabulary* against
  // VEHICLE_CATEGORIES below, mirroring how the vehicle endpoint does it.
  requiredVehicleType: z
    .string()
    .trim()
    .max(32)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  // MULTI-SELECT VEHICLE TYPES: the official categories the customer ticked.
  // Shape-validated here (array of bounded strings); the vocabulary, the
  // cargo/taxi split and de-duplication are enforced server-side further down
  // through the shared validateRequiredVehicleTypes() helper.
  requiredVehicleTypes: z
    .array(z.string().trim().max(32))
    .max(8)
    .optional()
    .nullable()
    .transform((v) => (Array.isArray(v) ? v : [])),
  // SEAT-CAPACITY MATCHING (Phase 1): passengers the customer travels with
  // (TAXI mode). Same 1..30 window as the carte-grise seats column, so the
  // two sides can never disagree. Null / omitted = no seat requirement.
  requiredSeats: z
    .number({ message: 'invalidSeats' })
    .int('invalidSeats')
    .min(1, 'invalidSeats')
    .max(30, 'invalidSeats')
    .optional()
    .nullable(),
  // PRICE NEGOTIATION (Phase 3): the customer opts into driver
  // counter-offers. Anything but an explicit boolean true is coerced to
  // false so a legacy / malicious payload can't smuggle a truthy value.
  // CARGO DEDICATED FLOW (Phase 4) layers a policy on top of this field
  // (see POST below): cargo orders are ALWAYS negotiable, so an explicit
  // `false` there is ignored; taxi keeps this exact opt-in behaviour.
  isNegotiable: z.boolean().optional(),
  // CARGO DEDICATED FLOW (Phase 4): bulk of the shipment. Drives the moto
  // incompatibility rule and the pricing weight when no explicit weight is
  // sent. Null / omitted = legacy client (no size policy applies).
  cargoSize: z.enum(['small', 'medium', 'large']).optional().nullable(),
  // CARGO DEDICATED FLOW (Phase 4): optional photo of the goods. Must be a
  // Vercel Blob URL produced by /api/uploads/order-image (host allow-list
  // enforced below) so a client can never plant arbitrary external URLs.
  cargoImageUrl: z.string().trim().max(600).optional().nullable(),
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
    // PHASE 8: per-user cap on this mutation. Placed AFTER the auth + role gate
    // on purpose so an unauthenticated caller is rejected with 401 first, and
    // the bucket is keyed on the session id, which is server-derived and cannot
    // be spoofed by the client.
    const rl = await rateLimit(`ordercreate:${session.id}`, 20, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      );
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

    // VEHICLE-TYPE MATCHING (Phase 2): reject an unknown category with a
    // structured 400 (the allow-list is echoed so a client can self-heal)
    // instead of storing a value that could never match any driver.
    if (
      data.requiredVehicleType !== null &&
      data.requiredVehicleType !== undefined &&
      !isVehicleCategory(data.requiredVehicleType)
    ) {
      return NextResponse.json(
        {
          error: 'invalidRequiredVehicleType',
          issues: { allowed: VEHICLE_CATEGORIES },
        },
        { status: 400 }
      );
    }

    // MULTI-SELECT VEHICLE TYPES: validate the official vocabulary, the
    // cargo/taxi split and the array bounds server-side. An ABSENT field is
    // "no preference" and is stored as an empty array; a field the client
    // explicitly sent but that is invalid is a 400, so a bad value can never
    // reach the DB and silently starve an order of drivers.
    let requiredVehicleTypes: OfficialVehicleCategory[] = [];
    if (data.requiredVehicleTypes !== undefined && data.requiredVehicleTypes !== null) {
      const result = validateRequiredVehicleTypes(data.requiredVehicleTypes);
      if (!result.ok) {
        return NextResponse.json(
          {
            error:
              result.reason === 'unknownCategory'
                ? 'invalidRequiredVehicleType'
                : `invalidVehicleTypes:${result.reason}`,
            issues: { allowed: OFFICIAL_VEHICLE_CATEGORIES },
          },
          { status: 400 }
        );
      }
      requiredVehicleTypes = result.value;
    }

    const requestedService = serviceCategoryFor(cargoType);
    // A TAXI booking is a single vehicle: the customer picks "4 seats or fewer"
    // OR "more than 5 seats", never both, so a two-element list is a request we
    // refuse rather than silently collapse (it would show one driver a
    // requirement the other does not have).
    if (requestedService === 'TAXI' && requiredVehicleTypes.length > 1) {
      return NextResponse.json({ error: 'taxiSingleVehicleTypeOnly' }, { status: 400 });
    }
    // A cargo order may not demand a passenger vehicle, and vice-versa.
    for (const category of requiredVehicleTypes) {
      if (vehicleCategorySide(category) !== requestedService) {
        return NextResponse.json({ error: 'vehicleCategoryServiceMismatch' }, { status: 400 });
      }
    }

    // CARGO DEDICATED FLOW (Phase 4) — cargo wizard fields.
    // (a) A "large" shipment and a required motorbike contradict each
    // other; block the impossible request with a structured 400 instead of
    // letting the order starve in `searching` with zero eligible drivers.
    const cargoSize = data.cargoSize ?? null;
    // The impossible combination is now expressed in official terms: a
    // "large" shipment that demands a two-wheeler. Compared through the
    // normalised value so a legacy `moto` request is caught as well.
    const demandsMotorbike =
      requiredVehicleTypes.includes('cargo_moto_2') ||
      (data.requiredVehicleType !== null &&
        data.requiredVehicleType !== undefined &&
        normalizeVehicleCategory(data.requiredVehicleType) === 'cargo_moto_2');
    if (cargoSize === 'large' && demandsMotorbike) {
      return NextResponse.json({ error: 'vehicleTooSmallForCargo' }, { status: 400 });
    }
    // (b) The goods photo must be one of OUR uploads (Vercel Blob host
    // allow-list), never an arbitrary URL the client invents.
    const cargoImageUrl =
      typeof data.cargoImageUrl === 'string' && data.cargoImageUrl ? data.cargoImageUrl : null;
    if (cargoImageUrl && !isAllowedCargoImageUrl(cargoImageUrl)) {
      return NextResponse.json({ error: 'invalidCargoImageUrl' }, { status: 400 });
    }
    // (c) Price policy: a cargo job is ALWAYS open to driver counter-offers
    // — the customer sets the service in motion, the driver names the
    // price. (The flat /accept path still works, so this only ADDS the
    // offer option; no caller loses a capability.) Taxi keeps the Phase 3
    // explicit opt-in semantics.
    const isNegotiable = cargoType !== 'taxi' ? true : data.isNegotiable === true;
    // (d) Double-submit guard: the wizard's confirm button, a flaky
    // connection retry or an impatient double-tap must not create two live
    // orders. An identical active order (same customer, route and cargo
    // type) created in the last 10 seconds is reported back instead of
    // duplicated — the client surfaces "order already in progress".
    const dupe = await db.order.findFirst({
      where: {
        customerId: session.id,
        status: { in: ['searching', 'scheduled', 'accepted', 'picked'] },
        cargoType,
        pickup,
        dropoff,
        createdAt: { gte: new Date(Date.now() - 10_000) },
      },
      select: { id: true, code: true },
    });
    if (dupe) {
      return NextResponse.json({ error: 'duplicateSubmit', orderId: dupe.id, code: dupe.code }, { status: 409 });
    }

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

    // C7: `Order.code` is @unique. generateOrderCode() now draws from a
    // ~2^40 space, so a collision is effectively impossible; the retry
    // wrapper below still regenerates the code on a Prisma P2002 so a
    // booking can never fail on one.
    let orderCode = generateOrderCode();
    const order = await retryOnUniqueViolation(
      () =>
        db.order.create({
          data: {
            code: orderCode,
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
                : // CARGO DEDICATED FLOW (Phase 4): the wizard sends a size,
                  // not a weight — price from the size's reference kg so the
                  // estimate matches what the driver will be quoted.
                  (cargoSize ? CARGO_SIZE_WEIGHT[cargoSize] : 20),
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
            // VEHICLE-TYPE MATCHING (Phase 2): persisted verbatim (already
            // validated against VEHICLE_CATEGORIES above) so the fan-out
            // and the driver request cards can filter on it. Null = the
            // customer did not require a specific vehicle.
            requiredVehicleType: data.requiredVehicleType ?? null,
            // MULTI-SELECT VEHICLE TYPES: the validated official categories.
            // Stored as an array; an empty array means "no preference" and keeps
            // every legacy read path behaving exactly as before.
            requiredVehicleTypes,
            // SEAT-CAPACITY MATCHING (Phase 1): persisted verbatim (already
            // validated above) so dispatch + the driver feed can filter on it.
            requiredSeats: data.requiredSeats ?? null,
            // CARGO DEDICATED FLOW (Phase 4): bulk of the shipment (drives
            // isVehicleCompatible rule (4) on the driver feed + accept) and
            // the optional photo of the goods shown on the request card.
            cargoSize,
            cargoImageUrl,
            // PRICE NEGOTIATION (Phase 3) + CARGO policy (Phase 4): cargo
            // orders are always negotiable, taxi keeps the explicit opt-in.
            isNegotiable,
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
        }),
      () => {
        orderCode = generateOrderCode();
      },
    );

    // C3 — driver fan-out for a live order now lives in `dispatch.ts` so the
    // scheduled-order dispatcher (/api/cron/dispatch-scheduled) reuses the
    // exact same push + in-app notification path. Fire-and-forget: a FCM
    // outage cannot leak an unhandled rejection from this handler.
    void (async () => {
      // SCHEDULED BOOKINGS: skip the driver fan-out for future-dated
      // orders. The order is stored in `status='scheduled'` and waits in
      // the "incoming scheduled" tab on the driver side. When the dispatcher
      // flips it to `searching` at the booked time, it runs the same
      // fanOutNewOrder() from its own route instead.
      if (data.scheduledAt) return;
      try {
        await fanOutNewOrder({
          id: order.id,
          code: order.code,
          cargoType: order.cargoType,
          pickup: order.pickup,
          dropoff: order.dropoff,
          // VEHICLE-TYPE MATCHING (Phase 2): forward the required category
          // so the fan-out only pings drivers whose vehicle matches. Null
          // (no preference) reproduces the original whole-pool behaviour.
          requiredVehicleType: order.requiredVehicleType ?? null,
          requiredSeats: order.requiredSeats ?? null,
          // MULTI-SELECT VEHICLE TYPES: forwarded so the fan-out only pings
          // drivers whose vehicle is one of the requested categories.
          requiredVehicleTypes: order.requiredVehicleTypes ?? [],
        });
        // C4 — realtime new-order event. customer-home used to emit
        // `order:created` from the client; with Pusher the client cannot
        // publish, so the route triggers the same eligible-driver list that
        // the push fan-out just computed. Drivers' request lists update
        // instantly without waiting for their 5s poll fallback.
        emitOrderNewRequest(
          order,
          // PHASE 7A FIX: the multi-select field is part of the matching
          // contract, so it MUST be forwarded here exactly as `fanOutNewOrder`
          // already does for the push pool. Omitting it made this realtime
          // pool wider than the push pool for a multi-select request (the
          // plural field would silently fall back to the legacy singular
          // field, or to no category filter at all). No new matching logic —
          // this is the same authoritative `findAvailableDrivers()` the push
          // path and the Phase 7A delivery path already use.
          await findAvailableDrivers(
            order.cargoType,
            order.requiredVehicleType ?? null,
            order.requiredSeats ?? null,
            order.requiredVehicleTypes ?? [],
          ),
        );
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
