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

const VEHICLE_TYPES = new Set([
  '125cc',
  '150cc',
  '200cc',
]);

interface ApplyDriverBody {
  name?: unknown;
  vehicleType?: unknown;
  vehicleColor?: unknown;
  plateNumber?: unknown;
  licenseNumber?: unknown;
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

    if (typeof body.name !== 'string' || body.name.trim().length < 2) {
      return NextResponse.json({ error: 'invalidName' }, { status: 400 });
    }
    if (
      typeof body.vehicleType !== 'string' ||
      !VEHICLE_TYPES.has(body.vehicleType)
    ) {
      return NextResponse.json({ error: 'invalidVehicleType' }, { status: 400 });
    }
    if (typeof body.vehicleColor !== 'string' || body.vehicleColor.trim().length < 1) {
      return NextResponse.json({ error: 'invalidVehicleColor' }, { status: 400 });
    }

    if (
      body.plateNumber !== undefined &&
      (typeof body.plateNumber !== 'string' || body.plateNumber.length > 32)
    ) {
      return NextResponse.json({ error: 'invalidPlateNumber' }, { status: 400 });
    }
    if (
      body.licenseNumber !== undefined &&
      (typeof body.licenseNumber !== 'string' || body.licenseNumber.length > 64)
    ) {
      return NextResponse.json({ error: 'invalidLicenseNumber' }, { status: 400 });
    }

    const canonicalPhone = normalizeAlgerianPhone(phone);
    if (!canonicalPhone) {
      return NextResponse.json({ error: 'invalidPhone' }, { status: 400 });
    }

    const existing = await db.user.findUnique({
      where: { phone: canonicalPhone },
      include: { driver: true },
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
        const updated = await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              name: body.name!.toString().trim(),
              accountStatus: 'pending',
            },
          });
          return tx.driver.update({
            where: { userId: existing.id },
            data: {
              vehicleType: body.vehicleType as string,
              vehicleColor: (body.vehicleColor as string).trim(),
              plateNumber: (body.plateNumber as string | undefined) || null,
              licenseNumber: (body.licenseNumber as string | undefined) || null,
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
      return tx.driver.create({
        data: {
          userId: user.id,
          vehicleType: body.vehicleType as string,
          vehicleColor: (body.vehicleColor as string).trim(),
          plateNumber: (body.plateNumber as string | undefined) || null,
          licenseNumber: (body.licenseNumber as string | undefined) || null,
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