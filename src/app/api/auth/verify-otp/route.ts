import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setPhoneVerification, setSession } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';
import type { AuthUser, Role } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone, code, name } = await req.json();

    // DIAG: trace every verify-otp attempt so we can correlate it with the
    // client-side [Driver Flow] / [Verify OTP] logs and see whether a second
    // call is firing after the first one already consumed the code.
    console.log('[Verify OTP API] Received request', { rawPhone, codeLen: typeof code === 'string' ? code.length : 0 });

    // SECURITY + UX: identical normalization to send-otp / frontend, so both
    // sides always agree and the stored code always maps to one canonical
    // phone per user.
    const phone = normalizeAlgerianPhone(rawPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'invalidPhone' },
        { status: 400 }
      );
    }

    // SECURITY: demo mode is force-disabled in production regardless of env.
    const demoMode =
      process.env.OTP_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';

    // Plausibility check only — exact matching happens against the stored row
    // below, so every failed attempt can be counted for brute-force defense.
    const plausible = demoMode
      ? typeof code === 'string' && code.length >= 4 && code.length <= 8
      : typeof code === 'string' && /^\d{6}$/.test(code);
    if (!plausible) {
      return NextResponse.json(
        { error: 'invalidOtp' },
        { status: 400 }
      );
    }

    // SECURITY: per-IP verification cap (brute-force budget per attacker).
    const ipCheck = await rateLimit(`otpverify:${clientIp(req)}`, 30, 15 * 60 * 1000);
    if (!ipCheck.ok) {
      return NextResponse.json(
        { error: 'tooManyAttempts', retryAfterSec: ipCheck.retryAfterSec },
        { status: 429 }
      );
    }

    const otp = await db.otpCode.findFirst({
      where: { phone },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // DIAG: temporary structured log to disambiguate the three early-exit
    // branches below (no row / expired / wrong code). Helps the user + on-call
    // tell whether the issue is a missing record, an expired TTL, or a real
    // mismatch — without changing any production behavior.
    console.log(
      '[VERIFY-OTP] Searching for phone:',
      phone,
      '| Found:',
      otp
        ? {
            id: otp.id,
            attempts: otp.attempts,
            expiresAt: otp.expiresAt,
            ageSec: Math.round(
              (Date.now() - new Date(otp.createdAt).getTime()) / 1000
            ),
          }
        : null
    );

    // No row at all for this phone — user never requested a code (or send-otp
    // failed silently). Distinct from "expired" so the UI can guide the user
    // to re-request instead of just calling the code wrong.
    if (!otp) {
      // DIAG: distinct from codeExpired/invalidOtp so we can tell whether the
      // code was never created OR was already consumed by a prior successful
      // call. The latter is the smoking gun for a double-submit race.
      console.warn('[Verify OTP API] Code not found or already consumed for phone:', phone);
      return NextResponse.json(
        { error: 'codeNotFound' },
        { status: 400 }
      );
    }

    // Row exists but its TTL has lapsed. Distinguish from codeNotFound so the
    // UI can say "expired, request a new one" rather than "wrong code".
    if (new Date(otp.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'codeExpired' },
        { status: 400 }
      );
    }

    // SECURITY: max 5 attempts per code — after that the code is dead even
    // if the correct digits are finally supplied.
    if (otp.attempts >= 5) {
      return NextResponse.json(
        { error: 'tooManyAttempts' },
        { status: 429 }
      );
    }

    if (otp.code !== code) {
      await db.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json(
        { error: 'invalidOtp' },
        { status: 400 }
      );
    }

    await db.otpCode.deleteMany({
      where: { phone },
    });

    const user = await db.user.findUnique({
      where: { phone },
      include: { driver: true },
    });

    if (!user || user.accountStatus !== 'active') {
      // SECURITY: a pending/rejected driver cannot receive a session.
      // If they are an existing driver (pending or rejected), surface that
      // specific state so the frontend can show a useful message.
      if (user && user.role === 'driver' && user.driver) {
        await setPhoneVerification(phone);
        return NextResponse.json({
          requiresSignup: false,
          driverApplicationPending: user.driver.applicationStatus === 'pending',
          driverApplicationRejected: user.driver.applicationStatus === 'rejected',
          phone,
        });
      }

      // AUTO-CREATE / ACTIVATE (signup screen removed): the caller has just
      // proven they control this phone with a valid 6-digit OTP — the same
      // proof of ownership the legacy `complete-signup` endpoint relied on
      // (it read the phone from the verification cookie this route sets
      // just below). So instead of returning `requiresSignup: true` and
      // pushing the customer to an email/password screen, provision the
      // account right here:
      //   role          = "customer" (FORCED server-side; never trusted from
      //                              the request body — same rule as
      //                              complete-signup / apply-driver)
      //   accountStatus = "active"   (a verified phone IS the activation)
      //   phoneVerified = true
      // Two sub-cases share this branch:
      //   - brand-new phone                    -> CREATE
      //   - pre-existing incomplete customer   -> ACTIVATE in place
      //     (the phone already exists in the DB, so a plain `create` would
      //      trip the @unique constraint; we update the existing row
      //      instead, keeping its id/name)
      // SECURITY: an existing `driver` never reaches here — the branch
      // above already returned for them.
      const record =
        user
          ? await db.user.update({
              where: { id: user.id },
              data: {
                // Honour a name typed on the phone screen when present;
                // otherwise keep whatever the row already has.
                name:
                  typeof name === 'string' && name.trim().length > 0
                    ? name.trim()
                    : user.name,
                accountStatus: 'active',
                phoneVerified: true,
              },
            })
          : await db.user.create({
              data: {
                phone,
                name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : '',
                // SECURITY: forced by the server.
                role: 'customer',
                accountStatus: 'active',
                phoneVerified: true,
              },
            });

      // Keep the phone-verification cookie consistent with the legacy
      // behaviour: it is still what the "upgrade to driver" flow reads
      // later (see /api/auth/apply-driver, gate A).
      await setPhoneVerification(phone);
      await setSession(record.id);

      const autoUser: AuthUser = {
        id: record.id,
        phone: record.phone,
        name: record.name,
        role: record.role as Role,
        avatar: record.avatar,
      };

      // `created` tells the caller this row was just provisioned. The login
      // flow ignores it; the "forgot password" flow uses it to keep the
      // original "account not found" UX for unknown phones instead of
      // silently creating + logging in a brand-new account through the
      // reset screen.
      return NextResponse.json({ user: autoUser, created: !user });
    }

    await setSession(user.id);

    const authUser: AuthUser = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role as Role,
      avatar: user.avatar,
    };

    return NextResponse.json({
      user: authUser,
    });
  } catch (e) {
    console.error('[WASSILHA VERIFY-OTP ERROR]', e);
    return NextResponse.json(
      {
        error: 'serverError',
        detail: String(e),
      },
      { status: 500 }
    );
  }
}
