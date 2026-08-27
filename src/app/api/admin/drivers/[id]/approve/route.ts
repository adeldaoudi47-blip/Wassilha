// PATCH /api/admin/drivers/:id/approve  (admin only)
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DriverProfile } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

function toDriverProfile(driver) {
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
    user: { id: driver.user.id, phone: driver.user.phone, name: driver.user.name, role: 'driver', avatar: driver.user.avatar },
  };
}

export async function PATCH(_req, { params }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const { id } = await params;
    const existing = await db.driver.findUnique({ where: { id }, include: { user: true } });
    if (!existing) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (existing.user.role !== 'driver') {
      return NextResponse.json({ error: 'notADriver' }, { status: 400 });
    }
    const updated = await db.$transaction(async (tx) => {
      const driverRow = await tx.driver.update({
        where: { id },
        data: { applicationStatus: 'active', isVerified: true, reviewedAt: new Date() },
        include: { user: true },
      });
      await tx.user.update({
        where: { id: driverRow.userId },
        data: { accountStatus: 'active', phoneVerified: true },
      });
      return driverRow;
    });
    return NextResponse.json(toDriverProfile(updated));
  } catch (e) {
    console.error('[WASSILHA APPROVE-DRIVER] Server error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
