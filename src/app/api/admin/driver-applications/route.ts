// GET /api/admin/driver-applications  (admin only)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';

export async function GET() {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
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
