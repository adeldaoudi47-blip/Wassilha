// PATCH /api/driver/vehicle
//
// Driver self-service endpoint to update the *carte grise* (vehicle
// registration) attached to their account. Lets a driver correct a typo
// in their plate number, change the brand after a repaint, or update
// the address without re-applying. Security model mirrors the rest of
// the driver routes:
//
//   - Must be logged in (`getSession`).
//   - Must have role "driver".
//   - The vehicle registration must already exist and belong to the
//     current driver (we look it up via `driver.userId = session.id`).
//
// What we *don't* expose here:
//   - The `typeProprietaire` / `nom` / `prenom` / `raisonSociale` block
//     is intentionally NOT editable from the profile screen — these
//     are KYC-relevant fields and changing them should go through the
//     admin. If we ever need to relax that, the allow-list below is
//     the single place to extend.
//   - The unique constraint on `numeroImmatriculation` is enforced at
//     the DB level too, so a race against another driver taking the
//     same plate surfaces as 409.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';

const ALLOWED_ENERGIES = new Set([
  'Benzine',
  'Diesel',
  'GPL',
  'Electrique',
  'Hybride',
]);

const OPTIONAL_STR_MAX = 128;

// Body of the PATCH. We Zod-validate the structure once, then enforce
// the cross-field rules (year range, energie allow-list) in code so the
// error codes stay consistent with the rest of the API.
const vehicleUpdateSchema = z.object({
  // Algerian plate — required, non-empty, <= 64 chars.
  numeroImmatriculation: z
    .string()
    .trim()
    .min(1, 'invalidNumeroImmatriculation')
    .max(64, 'invalidNumeroImmatriculation'),
  // Free-form brand. Required (same rule as apply-driver).
  marque: z
    .string()
    .trim()
    .min(1, 'invalidMarque')
    .max(64, 'invalidMarque'),
  // Vehicle type / model — optional, max 64 chars.
  type: z
    .string()
    .trim()
    .max(64, 'invalidType')
    .optional()
    .nullable(),
  // First-circulation year. We only check the *type* here (integer) and
  // the *range* below to keep error codes stable.
  anneePremiereMiseCirculation: z
    .number({ message: 'invalidAnneePremiereMiseCirculation' })
    .int('invalidAnneePremiereMiseCirculation'),
  // Free-form first-circulation date (kept as text to match apply-driver).
  datePremiereMiseEnCirculation: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
  // Carte-grisse address. Optional.
  adresse: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
  // Weight (kg), kept as string to preserve leading zeros and units
  // such as "1500" vs "1.5t". Optional.
  ptac: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
  poidsAVide: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
  // Restricted allow-list (see ALLOWED_ENERGIES). Optional.
  energie: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
  puissance: z
    .string()
    .trim()
    .max(OPTIONAL_STR_MAX)
    .optional()
    .nullable(),
});

function badRequest(error: string, issues?: unknown) {
  return NextResponse.json({ error, issues }, { status: 400 });
}

// Normalize an optional string field: undefined / null / blank => null,
// otherwise trimmed and capped at OPTIONAL_STR_MAX chars.
function optStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > OPTIONAL_STR_MAX ? t.slice(0, OPTIONAL_STR_MAX) : t;
}

export async function PATCH(req: NextRequest) {
  try {
    // SECURITY: throttle per-IP. Driver-profile updates are not
    // expected to happen often, so a low cap is safe.
    const ipCheck = await rateLimit(
      `driver-vehicle:${clientIp(req)}`,
      20,
      60 * 60 * 1000
    );
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = vehicleUpdateSchema.safeParse(body);
    if (!parsed.success) {
      // Pick the first issue to surface a stable error code, and pass
      // the full issues array so the client can inspect.
      const first = parsed.error.issues[0]?.message ?? 'invalidInput';
      return badRequest(first, parsed.error.issues);
    }
    const v = parsed.data;

    // Year range check (kept identical to apply-driver).
    const year = v.anneePremiereMiseCirculation;
    const currentYear = new Date().getFullYear();
    if (year < 1950 || year > currentYear + 1) {
      return badRequest('invalidAnneePremiereMiseCirculation');
    }

    // Energie allow-list. Empty / null is allowed (field is optional).
    const energie = optStr(v.energie);
    if (energie !== null && !ALLOWED_ENERGIES.has(energie)) {
      return badRequest('invalidEnergie');
    }

    // Look up the driver + their vehicle registration. We refuse early
    // if either is missing (admin-created accounts that somehow don't
    // have a VR would have to be re-applied).
    const driver = await db.driver.findUnique({
      where: { userId: session.id },
      include: { vehicleRegistration: true },
    });
    if (!driver) {
      return NextResponse.json({ error: 'noDriverProfile' }, { status: 404 });
    }
    if (!driver.vehicleRegistration) {
      return NextResponse.json(
        { error: 'noVehicleRegistration' },
        { status: 404 }
      );
    }

    // If the plate number is changing, check it isn't already used by
    // ANOTHER vehicle. The unique index will also catch this race, but
    // a friendly 409 is nicer than a Prisma P2002 error.
    const immat = v.numeroImmatriculation;
    if (immat !== driver.vehicleRegistration.numeroImmatriculation) {
      const clash = await db.vehicleRegistration.findUnique({
        where: { numeroImmatriculation: immat },
      });
      if (clash && clash.id !== driver.vehicleRegistration.id) {
        return NextResponse.json(
          { error: 'numeroImmatriculationAlreadyUsed' },
          { status: 409 }
        );
      }
    }

    const typeStr = optStr(v.type);

    const updated = await db.vehicleRegistration.update({
      where: { id: driver.vehicleRegistration.id },
      data: {
        numeroImmatriculation: immat,
        marque: v.marque,
        type: typeStr,
        anneePremiereMiseCirculation: year,
        datePremiereMiseEnCirculation: optStr(
          v.datePremiereMiseEnCirculation
        ),
        adresse: optStr(v.adresse),
        ptac: optStr(v.ptac),
        poidsAVide: optStr(v.poidsAVide),
        energie,
        puissance: optStr(v.puissance),
      },
    });

    return NextResponse.json({
      id: updated.id,
      numeroImmatriculation: updated.numeroImmatriculation,
      typeProprietaire: updated.typeProprietaire,
      nom: updated.nom,
      prenom: updated.prenom,
      raisonSociale: updated.raisonSociale,
      marque: updated.marque,
      type: updated.type,
      anneePremiereMiseCirculation: updated.anneePremiereMiseCirculation,
    });
  } catch (e) {
    // Prisma unique-constraint race: if a concurrent request just took
    // the plate between our pre-check and the update, surface 409
    // instead of a generic 500.
    const err = e as { code?: string; meta?: unknown };
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'numeroImmatriculationAlreadyUsed' },
        { status: 409 }
      );
    }
    console.error('[Driver Vehicle API] Server error:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
