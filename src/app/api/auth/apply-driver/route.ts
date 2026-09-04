// POST /api/auth/apply-driver
//
// Self-registration endpoint for prospective drivers. The body MUST include
// the phone-verification cookie (issued by /api/auth/verify-otp after the
// driver passed OTP) â€” the server then creates a User + Driver pair in a
// forced `pending` state. The client cannot influence role or accountStatus:
//   - role             = "driver"   (forced server-side)
//   - accountStatus    = "pending"  (forced server-side)
//   - applicationStatus= "pending"  (forced server-side)
//   - isVerified       = false      (forced server-side)
//
// The user is NOT logged in. They will only be granted a session after an
// admin approves their application AND they pass OTP again.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getVerifiedPhone, clearPhoneVerification, getSession } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import { OwnerType } from '@prisma/client';

const OWNER_TYPES: ReadonlySet<string> = new Set([
  OwnerType.PERSONNE_PHYSIQUE,
  OwnerType.PERSONNE_MORALE,
]);

// `serviceType` decides which orders the driver will receive once
// approved. Allowed values are a strict allow-list (free String column
// in the DB, so the API layer is the only enforcement point):
//   "CARGO"  -> original triporteur flow
//   "TAXI"   -> passenger transport (Yassir-like)
//   "BOTH"   -> both
// We use a free String for the column (not a Prisma enum) so that
// adding more service types later (e.g. "HEAVY", "PHARMACY") would
// not require a migration. Anything outside the allow-list falls
// back to "CARGO" (legacy behaviour) instead of being rejected with
// 400, so a misbehaving client cannot break the registration.
const ALLOWED_SERVICE_TYPES = new Set(['CARGO', 'TAXI', 'BOTH']);

function normalizeServiceType(raw: unknown): 'CARGO' | 'TAXI' | 'BOTH' {
  if (typeof raw === 'string' && ALLOWED_SERVICE_TYPES.has(raw)) {
    return raw as 'CARGO' | 'TAXI' | 'BOTH';
  }
  return 'CARGO';
}

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
  // Carte grise extended fields (all optional, except validation below).
  datePremiereMiseEnCirculation?: unknown;
  adresse?: unknown;
  ptac?: unknown;
  poidsAVide?: unknown;
  energie?: unknown;
  puissance?: unknown;
  // `serviceType` decides which orders the driver will receive after
  // admin approval. Persisted in `Driver.serviceType`. Allowed values
  // are restricted by `normalizeServiceType` below; anything outside
  // the allow-list falls back to "CARGO" (legacy behaviour) instead
  // of being rejected with 400, so a misbehaving client cannot break
  // the registration.
  serviceType?: unknown;
}

function badRequest(error: string, issues?: unknown) {
  return NextResponse.json({ error, issues }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    // DIAG: trace every driver-application attempt so we can correlate
    // it with the client-side `[Driver Flow]` logs.
    console.log('[Apply Driver API] Received request');
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

    // SECURITY: two valid gates â€” pick the first that matches.
    //
    //   (A) fresh OTP-verified phone cookie: same path the new driver flow
    //       has always used (phone is not yet tied to any account).
    //   (B) an *active* customer session for the same phone, used by the
    //       "upgrade to driver" flow on a profile screen. The session can
    //       only exist if the user already passed OTP for that phone, so
    //       the security guarantee is the same.
    //
    // Anything else (no cookie, no session, or a non-customer session) is
    // rejected with 403 so an unauthenticated probe can never reach the
    // DB write.
    const otpPhone = await getVerifiedPhone();
    const session = await getSession();
    let phone: string | null = null;
    let upgradeFromCustomer = false;
    if (otpPhone) {
      phone = otpPhone;
    } else if (session && session.role === 'customer') {
      phone = session.phone;
      upgradeFromCustomer = true;
    } else {
      console.error('[Apply Driver API] No verified phone cookie AND no active customer session! Rejecting.');
      return NextResponse.json(
        { error: 'phoneVerificationRequired' },
        { status: 403 }
      );
    }
    console.log(
      '[Apply Driver API] Phone authorized:',
      phone,
      upgradeFromCustomer ? '(upgrade-from-customer via session)' : '(fresh OTP cookie)'
    );

    const body = (await req.json().catch(() => ({}))) as ApplyDriverBody;

    // OWASP â€” API3:2023: validate the user-facing name (the only free-text
    // field on the public driver-application route) with Zod. Other
    // fields on this body are constrained to fixed enums / patterns and
    // are checked below with explicit type guards, so they stay readable.
    const nameSchema = z.string().trim().min(2, 'invalidName').max(100, 'invalidName');
    const nameParsed = nameSchema.safeParse(body.name);
    if (!nameParsed.success) {
      return badRequest('invalidName', nameParsed.error.issues);
    }
    const name = nameParsed.data;

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

    // ---- Carte grise extended fields (all optional strings) ----
    // Helper: normalize an optional string field. Returns null when the
    // client omits it, sends null, or sends a blank string. Otherwise
    // returns the trimmed value, capped at 128 chars to avoid DB abuse.
    const OPTIONAL_STR_MAX = 128;
    const optStr = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (t.length === 0) return null;
      return t.length > OPTIONAL_STR_MAX ? t.slice(0, OPTIONAL_STR_MAX) : t;
    };
    const datePremiereMiseEnCirculation = optStr(body.datePremiereMiseEnCirculation);
    const adresse = optStr(body.adresse);
    const ptac = optStr(body.ptac);
    const poidsAVide = optStr(body.poidsAVide);
    const energie = optStr(body.energie);
    const puissance = optStr(body.puissance);
    // Normalize the service type with an allow-list. Anything outside
    // "CARGO" / "TAXI" / "BOTH" falls back to "CARGO" so a typo on
    // the client (or a future value) never causes a 500. The result
    // is persisted in `Driver.serviceType` and used by the order
    // fan-out in `POST /api/orders` to filter who gets the push.
    const serviceType = normalizeServiceType(body.serviceType);
    // Restrict `energie` to a known short list so admins don't see garbage
    // in the dashboard. Empty / null is allowed (optional).
    if (energie !== null) {
      const allowed = new Set(['Benzine', 'Diesel', 'GPL', 'Electrique', 'Hybride']);
      if (!allowed.has(energie)) {
        return badRequest('invalidEnergie');
      }
    }

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
        // is deleted (not cascaded â€” we own the lifecycle here).
        const updated = await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              name: name,
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
              datePremiereMiseEnCirculation,
              adresse,
              ptac,
              poidsAVide,
              energie,
              puissance,
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
              // Persist the re-applied service type (the driver may have
              // changed their mind between rejections: cargo → taxi etc.).
              // The server already coerced the value to one of the three
              // allowed values via normalizeServiceType() above.
              serviceType,
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
      // UPGRADE FLOW: a logged-in customer on the same phone wants to apply
      // to become a driver. We perform the mutation in a single transaction
      // and revoke the customer's active sessions so they cannot keep
      // browsing as a customer while their application is pending.
      if (
        upgradeFromCustomer &&
        existing.role === 'customer' &&
        existing.accountStatus === 'active'
      ) {
        const updated = await db.$transaction(async (tx) => {
          // 1) Flip the existing user to a pending driver.
          await tx.user.update({
            where: { id: existing.id },
            data: {
              // Keep the same id, phone, name; only the role + status move.
              role: 'driver',
              accountStatus: 'pending',
            },
          });
          // 2) Create the new vehicle registration (carte grise).
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
              datePremiereMiseEnCirculation,
              adresse,
              ptac,
              poidsAVide,
              energie,
              puissance,
            },
          });
          // 3) Create the Driver row linked to the same userId. If an old
          //    Driver row exists (rare: a previous rejected application),
          //    we overwrite it cleanly so the user does not end up with
          //    two Driver rows for the same phone.
          const driverRow = await tx.driver.upsert({
            where: { userId: existing.id },
            create: {
              userId: existing.id,
              vehicleRegistrationId: vr.id,
              isOnline: false,
              isVerified: false,
              applicationStatus: 'pending',
              appliedAt: new Date(),
            },
            update: {
              vehicleRegistrationId: vr.id,
              applicationStatus: 'pending',
              appliedAt: new Date(),
              reviewedAt: null,
              isVerified: false,
            },
            include: { user: true },
          });
          // 4) Revoke every live session for this user â€” the upgrade
          //    changes the role, so the existing cookies are no longer
          //    safe to honor even on the same device. The customer is
          //    forced to sign back in once the admin approves.
          await tx.session.deleteMany({ where: { userId: existing.id } });
          return driverRow;
        });
        await clearPhoneVerification();
        // DIAG: record the upgrade so it shows up alongside regular driver
        // applications in the admin review queue.
        console.log(
          '[Apply Driver API] Customer upgraded to driver (pending): userId=',
          existing.id
        );
        return NextResponse.json(
          {
            ok: true,
            status: 'pending',
            driverId: updated.id,
            upgraded: true,
            requiresReauth: true,
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: 'phoneAlreadyRegistered' },
        { status: 409 }
      );
    }

    // DIAG: log the exact data we're about to persist so we can confirm
    // the request body made it through validation AND the cookie gate.
    console.log('[Apply Driver API] Creating driver with data:', {
      name: name,
      numeroImmatriculation: immat,
      typeProprietaire,
      marque,
      year,
    });

    const driver = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: canonicalPhone,
          name: name,
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
          datePremiereMiseEnCirculation,
          adresse,
          ptac,
          poidsAVide,
          energie,
          puissance,
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
          // serviceType comes from the client, coerced server-side via
          // normalizeServiceType() so it is always one of CARGO/TAXI/BOTH.
          // Defaults to "CARGO" for any client that omits the field,
          // matching the pre-taxi behaviour (every legacy driver
          // continues to receive the existing cargo order fan-out).
          serviceType,
        },
        include: { user: true },
      });
    });

    await clearPhoneVerification();

    return NextResponse.json(
      { ok: true, status: 'pending', driverId: driver.id },
      { status: 201 }
    );
  } catch (e: any) {
    // DIAG: forward the full error (including Prisma `code` like P2002
    // for unique-constraint violations) to both the server log and the
    // client response. The previous response shape was
    //   { error: 'serverError', detail: String(e) }
    // which already worked, but adding `code` lets the client surface a
    // more specific toast (e.g. "phone already registered") without an
    // extra round-trip.
    console.error('[Apply Driver API] Error:', e);
    return NextResponse.json(
      {
        error: 'serverError',
        detail: String(e?.message ?? e),
        code: e?.code,
      },
      { status: 500 }
    );
  }
}