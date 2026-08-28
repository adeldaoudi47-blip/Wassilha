import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/driver/location/[driverId]
//
// Returns the last known GPS position of the given driver (the one persisted
// on the Driver row by /api/driver/location). Used by the customer tracking
// page to seed the live driver marker with a fresh value before the first
// socket.io tick arrives.
//
// Auth: any authenticated user can read this (customers, drivers, admins).
// In the future this could be tightened to only allow participants of an
// active order between the two users.
type Ctx = { params: Promise<{ driverId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { driverId } = await params;
    if (!driverId) {
      return NextResponse.json({ error: 'missingDriverId' }, { status: 400 });
    }

    const driver = await db.driver.findUnique({
      where: { id: driverId },
      select: {
        currentLat: true,
        currentLng: true,
        lastSeenAt: true,
        isOnline: true,
      },
    });
    if (!driver) {
      return NextResponse.json({ error: 'driverNotFound' }, { status: 404 });
    }

    return NextResponse.json({
      currentLat: driver.currentLat,
      currentLng: driver.currentLng,
      lastSeenAt: driver.lastSeenAt?.toISOString() ?? null,
      isOnline: driver.isOnline,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
