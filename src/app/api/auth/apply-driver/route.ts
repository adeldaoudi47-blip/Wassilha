// POST /api/auth/apply-driver
//
// Self-registration endpoint for prospective drivers. The body MUST include
// the phone-verification cookie (issued by /api/auth/verify-otp after the
// driver passed OTP) — the server then creates a User + Driver pair in a
// forced `pending` state. The client cannot influence role or accountStatus:
//   - role             = "driver"   (forced server-side)
//   - accountStatus    = "pending"  (forced server-side)
//   - applicationStatus= "pending"  (forced server-side)
//   - isVerified       = false      (forced server-side)
//
// The user is NOT logged in. They will only be granted a session after an
// admin approves their application AND they pass OTP again.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getVerifiedPhone, clearPhoneVerification } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import { OwnerType } from '@prisma/client';

const OWNER_TYPES: ReadonlySet<string> = new Set([
  OwnerType.PERSONNE_PHYSIQUE,
  OwnerType.PERSONNE_MORALE,
]);

interface ApplyDriverBody {
  name?: unknown;
  numeroImmatriculation?: unknown;
  typeProprietaire?: unknown;
  nom?: unknown;
  prenom?: unknown;
  raisonSociale?: unknown;
  marque?: unknown;
  type?: unknown;
  anneePremiereMiseCirculation?: unknown;
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    // SECURITY: per-IP cap on driver-application submissions.
    const ipCheck = await rateLimit(
      `applydriver:${clientIp(req)}`,
      10,
      60 * 60 * 1000
    );
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    // SECURITY: must come from a fresh OTP-verified phone cookie — same gate
    // the customer signup uses, so attackers cannot bypass OTP.
    const phone = await getVerifiedPhone();
    if (!phone) {
      return NextResponse.json(
        { error: 'phoneVerificationRequired' },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ApplyDriverBody;

    // Driver identity (the user-facing full name).
    if (typeof body.name !== 'string' || body.name.trim().length < 2) {
      return badRequest('invalidName');
    }

    // Carte grise fields.
    if (
      typeof body.numeroImmatriculation !== 'string' ||
      body.numeroImmatriculation.trim().length < 1 ||
      body.numeroImmatriculation.length > 64
    ) {
      return badRequest('invalidNumeroImmatriculation');
    }

    if (
      typeof body.typeProprietaire !== 'string' ||
      !OWNER_TYPES.has(body.typeProprietaire)
    ) {
      return badRequest('invalidTypeProprietaire');
    }
    const typeProprietaire = body.typeProprietaire as OwnerType;

    let ownerNom: string | null = null;
    let ownerPrenom: string | null = null;
    let ownerRaisonSociale: string | null = null;
    if (typeProprietaire === OwnerType.PERSONNE_PHYSIQUE) {
      if (typeof body.nom !== 'string' || body.nom.trim().length < 1) {
        return badRequest('invalidNom');
      }
      if (typeof body.prenom !== 'string' || body.prenom.trim().length < 1) {
        return badRequest('invalidPrenom');
      }
      ownerNom = body.nom.trim();
      ownerPrenom = body.prenom.trim();
    } else {
      if (
        typeof body.raisonSociale !== 'string' ||
        body.raisonSociale.trim().length < 1
      ) {
        return badRequest('invalidRaisonSociale');
      }
      ownerRaisonSociale = body.raisonSociale.trim();
    }

    if (typeof body.marque !== 'string' || body.marque.trim().length < 1) {
      return badRequest('invalidMarque');
    }
    const marque = body.marque.trim();

    if (
      body.type !== undefined &&
      body.type !== null &&
      (typeof body.type !== 'string' || body.type.length > 64)
    ) {
      return badRequest('invalidType');
    }
    const typeStr =
      typeof body.type === 'string' && body.type.trim().length > 0
        ? body.type.trim()
        : null;

    if (
      typeof body.anneePremiereMiseCirculation !== 'number' ||
      !Number.isInteger(body.anneePremiereMiseCirculation)
    ) {
      return badRequest('invalidAnneePremiereMiseCirculation');
    }
    const year = body.anneePremiereMiseCirculation as number;
    const currentYear = new Date().getFullYear();
    if (year < 1950 || year > currentYear + 1) {
      return badRequest('invalidAnneePremiereMiseCirculation');
    }

    const canonicalPhone = normalizeAlgerianPhone(phone);
    if (!canonicalPhone) {
      return badRequest('invalidPhone');
    }

    // Reject duplicate registration numbers up-front so the transaction never
    // sees them. The DB also has a unique constraint as a final safeguard.
    const immat = body.numeroImmatriculation.trim();
    const existingImmat = await db.vehicleRegistration.findUnique({
      where: { numeroImmatriculation: immat },
    });
    if (existingImmat) {
      return NextResponse.json(
        { error: 'numeroImmatriculationAlreadyUsed' },
        { status: 409 }
      );
    }

    const existing = await db.user.findUnique({
      where: { phone: canonicalPhone },
      include: { driver: { include: { vehicleRegistration: true } } },
    });

    if (existing) {
      if (
        existing.role === 'driver' &&
        existing.accountStatus === 'active' &&
        existing.driver?.applicationStatus === 'active'
      ) {
        return NextResponse.json(
          { error: 'alreadyDriver' },
          { status: 409 }
        );
      }
      if (
        existing.role === 'driver' &&
        existing.driver?.applicationStatus === 'pending'
      ) {
        return NextResponse.json(
          { error: 'applicationAlreadyPending' },
          { status: 409 }
        );
      }
      if (
        existing.role === 'driver' &&
        existing.driver?.applicationStatus === 'rejected'
      ) {
        // Re-submission after a rejection: rebuild the carte grise and
        // reset the application lifecycle. The previous VehicleRegistration
        // is deleted (not cascaded — we own the lifecycle here).
        const updated = await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              name: body.name!.toString().trim(),
              accountStatus: 'pending',
            },
          });
          // Wipe any previous carte grise left dangling.
          if (existing.driver?.vehicleRegistrationId) {
            await tx.vehicleRegistration.deleteMany({
              where: { id: existing.driver.vehicleRegistrationId },
            });
          }
          const vr = await tx.vehicleRegistration.create({
            data: {
              numeroImmatriculation: immat,
              typeProprietaire,
              nom: ownerNom,
              prenom: ownerPrenom,
              raisonSociale: ownerRaisonSociale,
              marque,
              type: typeStr,
              anneePremiereMiseCirculation: year,
            },
          });
          return tx.driver.update({
            where: { userId: existing.id },
            data: {
              vehicleRegistrationId: vr.id,
              applicationStatus: 'pending',
              appliedAt: new Date(),
              reviewedAt: null,
              isVerified: false,
            },
            include: { user: true },
          });
        });
        await clearPhoneVerification();
        return NextResponse.json(
          { ok: true, status: 'pending', driverId: updated.id },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: 'phoneAlreadyRegistered' },
        { status: 409 }
      );
    }

    const driver = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: canonicalPhone,
          name: body.name!.toString().trim(),
          // SECURITY: forced by the server, NEVER read from the body.
          role: 'driver',
          accountStatus: 'pending',
          phoneVerified: true,
        },
      });
      const vr = await tx.vehicleRegistration.create({
        data: {
          numeroImmatriculation: immat,
          typeProprietaire,
          nom: ownerNom,
          prenom: ownerPrenom,
          raisonSociale: ownerRaisonSociale,
          marque,
          type: typeStr,
          anneePremiereMiseCirculation: year,
        },
      });
      return tx.driver.create({
        data: {
          userId: user.id,
          vehicleRegistrationId: vr.id,
          isOnline: false,
          isVerified: false,
          applicationStatus: 'pending',
          appliedAt: new Date(),
        },
        include: { user: true },
      });
    });

    await clearPhoneVerification();

    return NextResponse.json(
      { ok: true, status: 'pending', driverId: driver.id },
      { status: 201 }
    );
  } catch (e) {
    console.error('[WASSILHA APPLY-DRIVER] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}