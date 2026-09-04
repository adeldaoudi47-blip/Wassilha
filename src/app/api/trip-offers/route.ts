// TRIP OFFERS — list & create
// -----------------------------------------------------------------------------
// GET  /api/trip-offers         — browse available offers (customer / driver / admin)
// POST /api/trip-offers         — driver publishes a new offer
//
// Auth:
//   GET  → optional. Unauthenticated callers only see the
//          service-type-neutral view; authenticated customers can
//          still see what they booked. Drivers can also see their
//          own offers (including non-available statuses) by
//          passing `?mine=1`.
//   POST → driver only.
//
// Pricing / validation:
//   - `serviceType` is "TAXI" or "CARGO".
//   - `scheduledAt` is in the future (Zod refine).
//   - `price` is a positive int in DZD.
//   - `seatsAvail` is required when `serviceType === 'TAXI'`,
//     ignored otherwise. `cargoType` is required when
//     `serviceType === 'CARGO'`, ignored otherwise.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession as getSessionUser } from '@/lib/auth';
import { publicTripOfferSelect, tripOfferDriverSelect } from '@/lib/dto';

// Allowlist for `serviceType`. Kept in sync with `Driver.serviceType`
// (which is a free String on the DB but constrained to the same
// three values for every existing driver).
const SERVICE_TYPES = ['TAXI', 'CARGO'] as const;
// Allowlist for `cargoType` (matches Order.cargoType).
const CARGO_TYPES = [
  'parcel', 'goods', 'shop', 'furniture', 'appliance',
  'construction', 'personal', 'other',
] as const;

const createSchema = z
  .object({
    serviceType: z.enum(SERVICE_TYPES),
    pickup: z.string().min(1).max(200),
    dropoff: z.string().min(1).max(200),
    scheduledAt: z.coerce
      .date()
      // SCHEDULED BOOKINGS analogue: past dates are rejected so
      // the customer never sees a "ghost" offer that already
      // departed. The error is rendered as 400 by Next, not as
      // a silent null coercion (unlike the order form, where a
      // stale input is a recoverable UX).
      .refine((d) => d.getTime() > Date.now(), {
        message: 'scheduledAt must be in the future',
      }),
    price: z.number().int().positive().max(1_000_000),
    seatsAvail: z.number().int().positive().max(20).optional(),
    cargoType: z.enum(CARGO_TYPES).optional(),
  })
  // Cross-field: TAXI offers must specify seats, CARGO offers
  // must specify cargoType. We keep the validation here (and not
  // in the type system) because the payload is a Zod-validated
  // JSON blob from the client.
  .superRefine((v, ctx) => {
    if (v.serviceType === 'TAXI' && (v.seatsAvail === undefined || v.seatsAvail === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seatsAvail'],
        message: 'seatsAvail is required for TAXI offers',
      });
    }
    if (v.serviceType === 'CARGO' && !v.cargoType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cargoType'],
        message: 'cargoType is required for CARGO offers',
      });
    }
  });

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const serviceType = url.searchParams.get('serviceType') as
    | 'TAXI' | 'CARGO' | null;
  const mine = url.searchParams.get('mine') === '1';
  const user = await getSessionUser();

  // Customer-facing browse: only `available` offers that have not
  // departed yet, sorted by departure time. We deliberately do
  // NOT filter by driver region / city at the SQL level because
  // the platform is single-city (El Guerrara) and the listing is
  // short; the future cost is one extra column.
  if (!mine) {
    const offers = await db.tripOffer.findMany({
      where: {
        status: 'available',
        scheduledAt: { gt: new Date() },
        ...(serviceType ? { serviceType } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
      select: {
        ...publicTripOfferSelect,
        // Inline a slim driver shape so the customer can decide
        // "do I trust this driver?" without a second roundtrip.
        driver: { select: tripOfferDriverSelect },
      },
    });
    return NextResponse.json({ offers });
  }

  // Driver's own offers: any status, sorted by departure time.
  if (!user || user.role !== 'driver') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const driver = await db.driver.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!driver) {
    return NextResponse.json({ error: 'no_driver_profile' }, { status: 404 });
  }
  const offers = await db.tripOffer.findMany({
    where: { driverId: driver.id },
    orderBy: { scheduledAt: 'asc' },
    select: publicTripOfferSelect,
  });
  return NextResponse.json({ offers });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== 'driver') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const driver = await db.driver.findUnique({
    where: { userId: user.id },
    select: { id: true, serviceType: true, applicationStatus: true },
  });
  if (!driver) {
    return NextResponse.json({ error: 'no_driver_profile' }, { status: 404 });
  }
  // SECURITY: a pending or rejected driver cannot publish offers
  // (they cannot accept orders either). The check matches the
  // /api/orders POST fan-out.
  if (driver.applicationStatus && driver.applicationStatus !== 'active') {
    return NextResponse.json(
      { error: 'driver_not_active' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Driver who is BOTH can publish either. Driver who is only
  // CARGO or only TAXI must stick to their category — otherwise
  // they could publish a TAXI offer while the platform thinks
  // they only deliver goods.
  if (
    driver.serviceType !== 'BOTH' &&
    driver.serviceType !== data.serviceType
  ) {
    return NextResponse.json(
      {
        error: 'service_mismatch',
        message: `driver is registered as ${driver.serviceType}, cannot publish ${data.serviceType}`,
      },
      { status: 403 },
    );
  }

  const offer = await db.tripOffer.create({
    data: {
      driverId: driver.id,
      serviceType: data.serviceType,
      pickup: data.pickup,
      dropoff: data.dropoff,
      scheduledAt: data.scheduledAt,
      price: data.price,
      seatsAvail: data.serviceType === 'TAXI' ? data.seatsAvail ?? null : null,
      cargoType: data.serviceType === 'CARGO' ? data.cargoType ?? null : null,
      status: 'available',
    },
    select: publicTripOfferSelect,
  });
  return NextResponse.json({ offer }, { status: 201 });
}


