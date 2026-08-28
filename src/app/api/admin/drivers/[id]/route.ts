import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requirePrivilegedAdmin } from '@/lib/auth';
import type { DriverProfile } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

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

// PATCH /api/admin/drivers/:id  { isVerified?: boolean }  (admin only)
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    const { id } = await params;
    const body = await req.json();

    const existing = await db.driver.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    const data: any = {};
    if (typeof body.isVerified === 'boolean') data.isVerified = body.isVerified;
    if (typeof body.isOnline === 'boolean') data.isOnline = body.isOnline;

    const updated = await db.driver.update({
      where: { id },
      data,
      include: { user: true },
    });
    return NextResponse.json(toDriverProfile(updated));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
