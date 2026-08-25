import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateOrderCode } from '@/lib/wassilha-data';
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
      include: { customer: true, driver: true },
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

    const order = await db.order.create({
      data: {
        code: generateOrderCode(),
        customerId: session.id,
        cargoType,
        pickup: body.pickup,
        dropoff: body.dropoff,
        pickupLat:
          typeof body.pickupLat === 'number' ? body.pickupLat : 32.7833,
        pickupLng:
          typeof body.pickupLng === 'number' ? body.pickupLng : 3.7667,
        dropoffLat:
          typeof body.dropoffLat === 'number' ? body.dropoffLat : 32.79,
        dropoffLng:
          typeof body.dropoffLng === 'number' ? body.dropoffLng : 3.78,
        weight:
          typeof body.weight === 'number' && body.weight >= 0
            ? Math.round(body.weight)
            : 20,
        distance:
          typeof body.distance === 'number' && body.distance >= 0
            ? body.distance
            : 3.0,
        price:
          typeof body.price === 'number' && body.price >= 0
            ? Math.round(body.price)
            : 300,
        status: 'searching',
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      },
      include: { customer: true, driver: true },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
