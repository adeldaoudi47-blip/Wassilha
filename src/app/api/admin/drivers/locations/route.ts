// GET /api/admin/drivers/locations  (admin only)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';

export async function GET() {
  try {
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    // Only drivers with a *fresh* GPS fix in the last 10 minutes. The
    // client polls every 15s, so a 10-minute window keeps the marker
    // visible briefly after a driver goes offline (covers network
    // hiccups, a quick loss of GPS lock inside a building, etc.).
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await db.driver.findMany({
      where: {
        isVerified: true,
        currentLat: { not: null },
        currentLng: { not: null },
        lastSeenAt: { gte: cutoff },
      },
      include: { user: true, vehicleRegistration: true },
      orderBy: { lastSeenAt: 'desc' },
    });

    const out = rows
      .filter((d) => d.currentLat !== null && d.currentLng !== null && d.lastSeenAt !== null)
      .map((d) => ({
        id: d.id,
        name: d.user.name,
        phone: d.user.phone,
        avatar: d.user.avatar,
        isOnline: d.isOnline,
        isVerified: d.isVerified,
        rating: d.rating,
        totalTrips: d.totalTrips,
        currentLat: d.currentLat as number,
        currentLng: d.currentLng as number,
        lastSeenAt: (d.lastSeenAt as Date).toISOString(),
        vehicleLabel: d.vehicleRegistration?.marque ?? null,
      }));

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
