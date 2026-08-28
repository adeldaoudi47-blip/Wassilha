import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requirePrivilegedAdmin } from '@/lib/auth';
import type { DriverProfile, VehicleRegistrationInfo } from '@/lib/types';

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

// GET /api/admin/drivers  (admin only)
export async function GET() {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
    const drivers = await db.driver.findMany({
      include: { user: true, vehicleRegistration: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(drivers.map((d) => toDriverProfile(d as unknown as DriverWithRelations)));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// POST /api/admin/drivers  { name, phone, vehicleType, vehicleColor, numeroImmatriculation? }  (admin only)
export async function POST(req: NextRequest) {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can access.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
    const body = await req.json();
    if (
      typeof body.name !== 'string' ||
      typeof body.phone !== 'string' ||
      typeof body.vehicleType !== 'string' ||
      typeof body.vehicleColor !== 'string'
    ) {
      return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
    }

    const existing = await db.user.findUnique({
      where: { phone: body.phone },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'phoneAlreadyRegistered' },
        { status: 409 }
      );
    }

    // Admin-created drivers skip the pending workflow — they are immediately
    // active. (This is the only path that grants driver privileges without
    // an admin approval step.) They still need a VehicleRegistration row to
    // satisfy the Driver FK: if the admin did not pass a registration
    // number, we mint an internal placeholder so the schema stays consistent.
    const immat =
      typeof body.numeroImmatriculation === 'string' &&
      body.numeroImmatriculation.trim().length > 0
        ? body.numeroImmatriculation.trim()
        : `ADMIN-${Date.now()}-${body.phone.slice(-4)}`;

    const driver = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: body.phone,
          name: body.name,
          role: 'driver',
          accountStatus: 'active',
          phoneVerified: true,
        },
      });
      const vr = await tx.vehicleRegistration.create({
        data: {
          numeroImmatriculation: immat,
          typeProprietaire: 'PERSONNE_PHYSIQUE',
          nom: body.name,
          prenom: '-',
          marque: body.vehicleType,
          type: body.vehicleType,
          anneePremiereMiseCirculation: new Date().getFullYear(),
        },
      });
      const drv = await tx.driver.create({
        data: {
          userId: user.id,
          vehicleRegistrationId: vr.id,
          isOnline: false,
          isVerified: true,
          applicationStatus: 'active',
          appliedAt: new Date(),
          reviewedAt: new Date(),
        },
        include: { user: true, vehicleRegistration: true },
      });
      await tx.vehicle.create({
        data: {
          driverId: drv.id,
          type: body.vehicleType,
          color: body.vehicleColor,
        },
      });
      return drv;
    });

    return NextResponse.json(
      toDriverProfile(driver as unknown as DriverWithRelations),
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
