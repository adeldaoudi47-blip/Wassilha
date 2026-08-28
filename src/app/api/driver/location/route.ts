import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ensureRealtime, broadcastDriverLocation } from '@/lib/realtime-server';

// POST /api/driver/location
// Body: { lat: number, lng: number, orderId?: string, accuracy?: number }
//
// Updates the Driver row with the latest GPS fix and broadcasts the new
// position to every connected socket.io client subscribed to this driver's
// current order (or the orderId provided in the body if any).
//
// Auth: must be a logged-in driver. We look up the Driver by userId
// (the session id is the User id, not the Driver id).
//
// Validation: lat ∈ [-90, 90], lng ∈ [-180, 180]. Anything else is rejected
// with 400 to prevent corrupted data from a buggy client from poisoning
// the live position.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = (await req.json()) as {
      lat?: unknown;
      lng?: unknown;
      orderId?: unknown;
      accuracy?: unknown;
    };

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const orderId = typeof body.orderId === 'string' ? body.orderId : null;
    const accuracy =
      typeof body.accuracy === 'number' && Number.isFinite(body.accuracy)
        ? body.accuracy
        : null;

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json(
        { error: 'invalidCoordinates' },
        { status: 400 }
      );
    }

    // Persist the last known position on the Driver row. This is the
    // source-of-truth fallback when the customer opens the tracking page
    // before the first live tick arrives.
    const driver = await db.driver.update({
      where: { userId: session.id },
      data: {
        currentLat: lat,
        currentLng: lng,
        lastSeenAt: new Date(),
      },
      select: { id: true, currentLat: true, currentLng: true, lastSeenAt: true },
    });

    // Make sure the socket.io server is up before we try to broadcast.
    // In dev/prod it's normally already attached to the Next.js process.
    ensureRealtime();

    // Broadcast the position update to every connected client subscribed
    // to this order. Falls through silently if realtime isn't booted yet
    // (the DB write is the source of truth; the next tick will recover).
    if (orderId) {
      try {
        broadcastDriverLocation(orderId, lat, lng, driver.id);
      } catch (e) {
        console.warn('[driver/location] realtime broadcast failed:', String(e));
      }
    }

    return NextResponse.json({
      ok: true,
      currentLat: driver.currentLat,
      currentLng: driver.currentLng,
      lastSeenAt: driver.lastSeenAt?.toISOString() ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
