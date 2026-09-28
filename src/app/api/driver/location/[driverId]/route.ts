import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/driver/location/[driverId]
//
// Returns the last known GPS position of the given driver (the one persisted
// on the Driver row by /api/driver/location). Used by the customer tracking
// page to seed the live driver marker with a fresh value before the first
// Pusher tick arrives.
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
        userId: true,
        currentLat: true,
        currentLng: true,
        lastSeenAt: true,
        isOnline: true,
      },
    });
    if (!driver) {
      return NextResponse.json({ error: 'driverNotFound' }, { status: 404 });
    }

    // PHASE 1 - PRIVACY GATE. This route used to hand any authenticated user
    // the live position of any driver (the file's own comment said so). A
    // driver's whereabouts are only legitimate for the driver themself, for
    // an admin, or for a customer with a LIVE order with that driver.
    //
    // PHASE 5 - ACTIVE-TRIP GATE. Phase 1 accepted any historical order the
    // two had ever shared, so a customer kept a permanent licence to pull the
    // driver's GPS months after the trip ended. Only the two statuses where
    // the driver is physically en route (`accepted` = coming to pickup,
    // `picked` = in transit) justify a position read - and they are exactly
    // the two states `customer-track.tsx` seeds its marker in, so no live
    // screen loses data. `delivered` / `cancelled` are history, not tracking.
    if (driver.userId !== session.id && session.role !== 'admin') {
      const liveOrder = await db.order.findFirst({
        where: {
          driverId: driver.userId,
          customerId: session.id,
          status: { in: ['accepted', 'picked'] },
        },
        select: { id: true },
      });
      if (!liveOrder) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
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
