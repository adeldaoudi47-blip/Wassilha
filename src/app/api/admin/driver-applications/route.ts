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
      include: { user: true, vehicleRegistration: true },
      orderBy: { appliedAt: 'desc' },
    });
    return NextResponse.json(
      drivers.map((d) => ({
        id: d.id,
        userId: d.userId,
        name: d.user.name,
        phone: d.user.phone,
        applicationStatus: d.applicationStatus,
        appliedAt: d.appliedAt,
        reviewedAt: d.reviewedAt,
        createdAt: d.createdAt,
        // Carte grise (vehicle registration) — admins review this before
        // approving/rejecting a driver application.
        vehicleRegistration: d.vehicleRegistration
          ? {
              id: d.vehicleRegistration.id,
              numeroImmatriculation: d.vehicleRegistration.numeroImmatriculation,
              typeProprietaire: d.vehicleRegistration.typeProprietaire,
              nom: d.vehicleRegistration.nom,
              prenom: d.vehicleRegistration.prenom,
              raisonSociale: d.vehicleRegistration.raisonSociale,
              marque: d.vehicleRegistration.marque,
              type: d.vehicleRegistration.type,
              anneePremiereMiseCirculation:
                d.vehicleRegistration.anneePremiereMiseCirculation,
            }
          : null,
      }))
    );
  } catch (e) {
    console.error('[WASSILHA DRIVER-APPLICATIONS] Server error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
