// PATCH /api/admin/drivers/:id/reject  (admin only)
//
// "Ban" / "suspend" a driver. We use the existing 'rejected' status
// (also used for failed applications) so the user-side `verify-otp`
// gate — which refuses to issue a session unless `accountStatus ===
// 'active'` — already blocks the driver from logging in again.
//
// On top of flipping the flag we also:
//   1. Force `isOnline = false` so the order fan-out ignores them
//      immediately (no new ping), and
//   2. Hard-delete all `Session` rows for that user so any in-flight
//      cookie is invalidated. The next request from the suspended
//      driver hits a 401.
//
// We keep the driver + vehicle rows on disk on purpose: hard delete
// would orphan the historical orders they delivered (which are a legal
// record) and would also break ratings.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

function toDriverProfile(driver: any) {
  return {
    id: driver.id,
    userId: driver.userId,
    isOnline: driver.isOnline,
    isVerified: driver.isVerified,
    rating: driver.rating,
    totalTrips: driver.totalTrips,
    totalEarnings: driver.totalEarnings,
    applicationStatus: driver.applicationStatus,
    appliedAt: driver.appliedAt,
    reviewedAt: driver.reviewedAt,
    vehicleRegistration: driver.vehicleRegistration ?? null,
    user: { id: driver.user.id, phone: driver.user.phone, name: driver.user.name, role: 'driver', avatar: driver.user.avatar },
  };
}

export async function PATCH(_req, { params }) {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
    const { id } = await params;
    const existing = await db.driver.findUnique({ where: { id }, include: { user: true, vehicleRegistration: true } });
    if (!existing) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (existing.user.role !== 'driver') {
      return NextResponse.json({ error: 'notADriver' }, { status: 400 });
    }
    const updated = await db.$transaction(async (tx) => {
      const driverRow = await tx.driver.update({
        where: { id },
        data: {
          applicationStatus: 'rejected',
          isVerified: false,
          // SECURITY: force the driver offline so the order fan-out
          // stops pinging them right away.
          isOnline: false,
          reviewedAt: new Date(),
        },
        include: { user: true, vehicleRegistration: true },
      });
      await tx.user.update({
        where: { id: driverRow.userId },
        data: { accountStatus: 'rejected' },
      });
      // SECURITY: invalidate any active cookie. Even if the client
      // still holds a valid JWT, the Session row is gone so the
      // next getSession() returns null and they get 401.
      await tx.session.deleteMany({
        where: { userId: driverRow.userId },
      });
      return driverRow;
    });
    return NextResponse.json(toDriverProfile(updated));
  } catch (e) {
    console.error('[WASSILHA REJECT-DRIVER] Server error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
