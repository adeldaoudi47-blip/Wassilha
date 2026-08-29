import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requirePrivilegedAdmin } from '@/lib/auth';
import type { DriverProfile, VehicleRegistrationInfo } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

type DriverWithRelations = {
  id: string;
  userId: string;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  applicationStatus: string;
  appliedAt: Date | null;
  reviewedAt: Date | null;
  currentLat: number | null;
  currentLng: number | null;
  lastSeenAt: Date | null;
  user: { id: string; phone: string; name: string; role: string; avatar: string | null };
  vehicleRegistration: {
    id: string;
    numeroImmatriculation: string;
    typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
    nom: string | null;
    prenom: string | null;
    raisonSociale: string | null;
    marque: string;
    type: string | null;
    anneePremiereMiseCirculation: number;
  } | null;
};

function toDriverProfile(driver: DriverWithRelations): DriverProfile {
  const vrInfo: VehicleRegistrationInfo | null = driver.vehicleRegistration
    ? {
        id: driver.vehicleRegistration.id,
        numeroImmatriculation: driver.vehicleRegistration.numeroImmatriculation,
        typeProprietaire: driver.vehicleRegistration.typeProprietaire,
        nom: driver.vehicleRegistration.nom,
        prenom: driver.vehicleRegistration.prenom,
        raisonSociale: driver.vehicleRegistration.raisonSociale,
        marque: driver.vehicleRegistration.marque,
        type: driver.vehicleRegistration.type,
        anneePremiereMiseCirculation:
          driver.vehicleRegistration.anneePremiereMiseCirculation,
      }
    : null;
  return {
    id: driver.id,
    userId: driver.userId,
    isOnline: driver.isOnline,
    isVerified: driver.isVerified,
    rating: driver.rating,
    totalTrips: driver.totalTrips,
    totalEarnings: driver.totalEarnings,
    applicationStatus: driver.applicationStatus as
      | 'active'
      | 'pending'
      | 'rejected',
    appliedAt: driver.appliedAt ? driver.appliedAt.toISOString() : null,
    reviewedAt: driver.reviewedAt ? driver.reviewedAt.toISOString() : null,
    currentLat: driver.currentLat,
    currentLng: driver.currentLng,
    lastSeenAt: driver.lastSeenAt ? driver.lastSeenAt.toISOString() : null,
    vehicleRegistration: vrInfo,
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
      include: { user: true, vehicleRegistration: true },
    });
    return NextResponse.json(toDriverProfile(updated as unknown as DriverWithRelations));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
