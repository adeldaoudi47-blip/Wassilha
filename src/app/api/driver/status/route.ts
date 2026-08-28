import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DriverProfile } from '@/lib/types';

// PATCH /api/driver/status  { isOnline: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json();
    if (typeof body.isOnline !== 'boolean') {
      return NextResponse.json(
        { error: 'invalidBody' },
        { status: 400 }
      );
    }

    const driver = await db.driver.update({
      where: { userId: session.id },
      data: { isOnline: body.isOnline },
      include: { user: true, vehicleRegistration: true },
    });

    const profile: DriverProfile = {
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
      vehicleRegistration: driver.vehicleRegistration
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
        : null,
      user: {
        id: driver.user.id,
        phone: driver.user.phone,
        name: driver.user.name,
        role: 'driver',
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
