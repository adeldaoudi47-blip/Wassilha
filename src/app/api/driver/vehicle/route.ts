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
import {
  OFFICIAL_VEHICLE_CATEGORIES,
  isSeatsValidForTaxiCategory,
  normalizeVehicleCategory,
  taxiSeatRange,
} from '@/lib/types';
import type { VehicleCategory } from '@/lib/types';

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
  // Number of passenger seats (TAXI only). Optional -- null for cargo.
  // Stored as Int; ranges 1..30 are accepted, anything outside returns 400.
  seats: z
    .number({ message: 'invalidSeats' })
    .int('invalidSeats')
    .min(1, 'invalidSeats')
    .max(30, 'invalidSeats')
    .optional()
    .nullable(),
  // VEHICLE CLASSIFICATION (Phase 1): the commercial category of the
  // vehicle (moto / pickup / refrigerated / …). Free String on the column
  // so this endpoint can accept any value, but unknown keys are rejected
  // in code below against VEHICLE_CATEGORIES so the DB vocabulary stays
  // honest. `null` clears the category; `undefined` leaves it untouched.
  vehicleCategory: z.string().trim().max(32).optional().nullable(),
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

    // VEHICLE CLASSIFICATION (Phase 1): reject any value the shared
    // vocabulary does not know, so a misbehaving client can never store a
    // bogus category that would then never match a customer's requirement.
    // `null` (clear the category) and `undefined` (don't touch it) are both
    // fine here.
    // OFFICIAL VEHICLE CLASSIFICATION: the category is normalised to the
    // official vocabulary on the way in, so a legacy client that still posts
    // "moto" / "taxi_car_7" updates the row to its canonical value instead of
    // re-writing an old spelling. An unknown value is still a 400.
    const normalizedCategory =
      v.vehicleCategory === undefined || v.vehicleCategory === null
        ? null
        : normalizeVehicleCategory(v.vehicleCategory);
    if (normalizedCategory === null && v.vehicleCategory) {
      return badRequest('invalidVehicleCategory', {
        allowed: OFFICIAL_VEHICLE_CATEGORIES,
      });
    }

    // Year range check (kept identical to apply-driver).
    const year = v.anneePremiereMiseCirculation;
    const currentYear = new Date().getFullYear();
    if (year < 1950 || year > currentYear + 1) {
      return badRequest('invalidAnneePremiereMiseCirculation');
    }

    // (Legacy) the driver-facing form used to collect energie and validate
    // it against a known short list. The field is no longer on the new
    // form, but the energie column is still kept on
    // VehicleRegistration for backwards-compatibility with rows created
    // by older applications. We simply stop writing to it from this
    // endpoint.

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

    // OFFICIAL VEHICLE CLASSIFICATION - TAXI SEAT BAND.
    //
    // Zod above only bounds `seats` to 1..30 in absolute terms; it cannot know
    // which capacity CLASS the vehicle belongs to. That cross-check was missing
    // here, so a driver could edit a "taxi_up_to_4" to 9 seats after
    // registration and end up with a vehicle the category does not describe.
    //
    // The rule itself is NOT re-implemented: `isSeatsValidForTaxiCategory()` is
    // the same shared helper POST /api/auth/apply-driver uses, so "what counts as
    // a legal taxi_up_to_4 / taxi_over_5" has exactly one definition
    // (taxi_up_to_4 -> 1..4, taxi_over_5 -> 6..30, legacy taxi_car / taxi_car_7
    // included). Cargo categories have no band and are therefore never
    // restricted.
    //
    // This PATCH is partial, so the EFFECTIVE post-update pair is validated: the
    // category is the submitted one when present, otherwise the stored one, and
    // likewise for the seat count. Validating only the submitted fields would let
    // a request change one half of the pair and leave it contradicting the other.
    const effectiveCategory =
      v.vehicleCategory === undefined
        ? normalizeVehicleCategory(driver.vehicleRegistration.vehicleCategory)
        : normalizedCategory;
    // `seats` is written as `v.seats ?? null`, so mirror that exactly: an
    // omitted/cleared seat count means "no capacity recorded", which no band
    // can contradict.
    const effectiveSeats = v.seats ?? null;
    if (effectiveSeats !== null && !isSeatsValidForTaxiCategory(effectiveCategory, effectiveSeats)) {
      return badRequest('seatsMismatchVehicleCategory', {
        vehicleCategory: effectiveCategory,
        range: taxiSeatRange(effectiveCategory),
        received: effectiveSeats,
      });
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
        // Forward seats directly (already a number|undefined|null after
        // Zod validation). For CARGO drivers the column stays null.
        seats: v.seats ?? null,
        // VEHICLE CLASSIFICATION: only persisted when the client explicitly
        // sent the key (undefined => keep the previous value so older clients
        // don't wipe a driver's category on their next save). The value stored
        // is the NORMALISED official category, so a client still posting a
        // legacy spelling upgrades the row instead of re-saving the old one.
        ...(v.vehicleCategory === undefined
          ? {}
          : { vehicleCategory: normalizedCategory }),
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
      // VEHICLE CLASSIFICATION (Phase 1): echoed back so the driver
      // profile UI can show the saved category without a refetch. The DB
      // column is a free String; the value has already been validated
      // against VEHICLE_CATEGORIES above so the cast to the union is safe.
      vehicleCategory: updated.vehicleCategory as VehicleCategory | null,
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
