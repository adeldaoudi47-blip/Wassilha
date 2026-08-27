import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DriverProfile } from '@/lib/types';

function toDriverProfile(driver: {
  id: string;
  userId: string;
  vehicleType: string;
  vehicleColor: string;
  plateNumber: string | null;
  licenseNumber: string | null;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  user: { id: string; phone: string; name: string; role: string; avatar: string | null };
}): DriverProfile {
  return {
    id: driver.id,
    userId: driver.userId,
    vehicleType: driver.vehicleType,
    vehicleColor: driver.vehicleColor,
    plateNumber: driver.plateNumber,
    licenseNumber: driver.licenseNumber,
    isOnline: driver.isOnline,
    isVerified: driver.isVerified,
    rating: driver.rating,
    totalTrips: driver.totalTrips,
    totalEarnings: driver.totalEarnings,
    user: {
      id: driver.user.id,
      phone: driver.user.phone,
      name: driver.user.name,
      role: 'driver',
      avatar: driver.user.avatar,
    },
  };
}

// GET /api/admin/drivers  (admin only)
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const drivers = await db.driver.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(drivers.map(toDriverProfile));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// POST /api/admin/drivers  { name, phone, vehicleType, vehicleColor }  (admin only)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json();
    if (
      typeof body.name !== 'string' ||
      typeof body.phone !== 'string' ||
      typeof body.vehicleType !== 'string' ||
      typeof body.vehicleColor !== 'string'
    ) {
      return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
    }

    const existing = await db.user.findUnique({
      where: { phone: body.phone },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'phoneAlreadyRegistered' },
        { status: 409 }
      );
    }

    // Create the user + driver + vehicle atomically.
    // Admin-created drivers skip the pending workflow — they are immediately
    // active. (This is the only path that grants driver privileges without
    // an admin approval step.)
    const user = await db.user.create({
      data: {
        phone: body.phone,
        name: body.name,
        role: 'driver',
        accountStatus: 'active',
        phoneVerified: true,
      },
    });
    const driver = await db.driver.create({
      data: {
        userId: user.id,
        vehicleType: body.vehicleType,
        vehicleColor: body.vehicleColor,
        isOnline: false,
        isVerified: true,
        applicationStatus: 'active',
        appliedAt: new Date(),
        reviewedAt: new Date(),
      },
      include: { user: true },
    });
    await db.vehicle.create({
      data: {
        driverId: driver.id,
        type: body.vehicleType,
        color: body.vehicleColor,
      },
    });

    return NextResponse.json(toDriverProfile(driver), { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
