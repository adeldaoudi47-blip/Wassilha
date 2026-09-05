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
      // SECURITY (V15 — driver PII hygiene): select only the public
      // User fields when joining. Using `include: { user: true }` would
      // return passwordHash, email, phoneVerified, accountStatus, and
      // timestamps. Defense in depth: toUserPublic() is also applied in
      // the response mapper.
      include: {
        user: { select: { id: true, phone: true, name: true, role: true, avatar: true } },
        vehicleRegistration: true,
      },
    });
    return NextResponse.json(toDriverProfile(updated as unknown as DriverWithRelations));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/drivers/:id  (admin only)
//
// Hard-delete a driver account and every row that points to it.
//
// Safety guards:
//   1. requirePrivilegedAdmin() — only the hard-coded admin phone
//      can fire this. PATCH is also behind the same gate, so admins
//      shouldn't be able to reach DELETE by accident.
//   2. refuse to delete a driver that has historical Orders or
//      Ratings. Those are financial records the company is legally
//      required to keep (Algeria bookkeeping rules + we need them for
//      customer support). The admin sees `error: 'hasHistory'` and
//      has to use the ban flow instead.
//   3. everything happens inside a single Prisma transaction. If
//      any step throws, the database is left untouched.
//
// Cascade map (from prisma/schema.prisma):
//   Driver.userId → User.id           onDelete: Cascade
//     → Session, PushToken, User (self) all drop with the User
//   Driver.vehicleRegistrationId → VehicleRegistration.id  SetNull
//     → we delete the VR explicitly first so the Driver row has
//       nothing to null out.
//   TripOffer.driverId → Driver.id   onDelete: Cascade
//     → all offers vanish with the Driver.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    const { id } = await params;
    const existing = await db.driver.findUnique({
      where: { id },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    if (existing.user.role !== 'driver') {
      return NextResponse.json({ error: 'notADriver' }, { status: 400 });
    }

    // 1. History guard. We can't cascade-delete Orders / Ratings
    // because they also point at *customers* and *other drivers* via
    // fromId/toId — nuking them would erase receipts the rest of the
    // platform needs. So we simply refuse the request.
    const [orderCount, ratingCount] = await Promise.all([
      db.order.count({ where: { driverId: existing.userId } }),
      db.rating.count({
        where: { OR: [{ toId: existing.userId }, { fromId: existing.userId }] },
      }),
    ]);
    if (orderCount > 0 || ratingCount > 0) {
      return NextResponse.json(
        {
          error: 'hasHistory',
          detail:
            'Driver has historical orders or ratings and cannot be hard-deleted. Use the ban flow instead.',
          counts: { orders: orderCount, ratings: ratingCount },
        },
        { status: 409 }
      );
    }

    // 2. Transactional teardown. We delete in FK-safe order:
    //    VR (no incoming FK in our schema that would block it) →
    //    Driver (SetNull on vehicleRegistrationId becomes moot) →
    //    User (Cascade drops Sessions / PushTokens).
    const userId = existing.userId;
    await db.$transaction(async (tx) => {
      const driverRow = await tx.driver.findUnique({
        where: { id },
        select: { vehicleRegistrationId: true },
      });
      if (driverRow?.vehicleRegistrationId) {
        await tx.vehicleRegistration.delete({
          where: { id: driverRow.vehicleRegistrationId },
        });
      }
      await tx.driver.delete({ where: { id } });
      await tx.user.delete({ where: { id: userId } });
    });

    return NextResponse.json({ ok: true, id, userId });
  } catch (e) {
    console.error('[WASSILHA DELETE-DRIVER] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
