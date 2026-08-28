// PATCH /api/admin/drivers/:id/reject  (admin only)
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
        data: { applicationStatus: 'rejected', isVerified: false, reviewedAt: new Date() },
        include: { user: true, vehicleRegistration: true },
      });
      await tx.user.update({
        where: { id: driverRow.userId },
        data: { accountStatus: 'rejected' },
      });
      return driverRow;
    });
    return NextResponse.json(toDriverProfile(updated));
  } catch (e) {
    console.error('[WASSILHA REJECT-DRIVER] Server error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
