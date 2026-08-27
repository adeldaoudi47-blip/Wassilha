// GET /api/admin/driver-applications  (admin only)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const drivers = await db.driver.findMany({
      where: { applicationStatus: { in: ['pending', 'rejected'] } },
      include: { user: true },
      orderBy: { appliedAt: 'desc' },
    });
    return NextResponse.json(
      drivers.map((d) => ({
        id: d.id,
        userId: d.userId,
        name: d.user.name,
        phone: d.user.phone,
        vehicleType: d.vehicleType,
        vehicleColor: d.vehicleColor,
        plateNumber: d.plateNumber,
        licenseNumber: d.licenseNumber,
        applicationStatus: d.applicationStatus,
        appliedAt: d.appliedAt,
        reviewedAt: d.reviewedAt,
        createdAt: d.createdAt,
      }))
    );
  } catch (e) {
    console.error('[WASSILHA DRIVER-APPLICATIONS] Server error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
