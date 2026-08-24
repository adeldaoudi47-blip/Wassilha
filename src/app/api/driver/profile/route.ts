import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DriverProfile } from '@/lib/types';

// GET /api/driver/profile
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const driver = await db.driver.findUnique({
      where: { userId: session.id },
      include: { user: true },
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 404 });
    }

    const profile: DriverProfile = {
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
        role: driver.user.role as 'driver',
        avatar: driver.user.avatar,
      },
    };
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
