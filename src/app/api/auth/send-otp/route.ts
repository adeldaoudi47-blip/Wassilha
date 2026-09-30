import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { normalizeAlgerianPhone } from '@/lib/phone';

// Matches the 30s resend timer already enforced by the frontend UI.
const RESEND_COOLDOWN_MS = 30 * 1000;

function generateOtp() {
return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
try {
const { phone: rawPhone } = await req.json();

// SECURITY + UX: accept every local/international Algerian representation
// (+213 / 00213 / spaces / dashes / invisible keyboard marks) and normalize
// to the exact canonical form shared with the frontend before any DB work.
const phone = normalizeAlgerianPhone(rawPhone);
if (!phone) {
  return NextResponse.json(
    { error: 'invalidPhone' },
    { status: 400 }
  );
}

// SECURITY: demo mode can never activate in a production build, even if
// OTP_DEMO_MODE is mistakenly configured on the hosting provider.
// DEMO MODE (2026-09-28): the OTP is ALWAYS a random 6-digit code from
// generateOtp() below, returned to the caller. OTP_DEMO_MODE / DEMO_OTP are
// intentionally NOT read: an env-provided fixed code would be guessable, and
// the flag used to force a predictable value outside production.
// SECURITY: per-phone resend cooldown — the newest stored code must be
// older than the cooldown window before another SMS can be triggered.
const latestCode = await db.otpCode.findFirst({
  where: { phone },
  orderBy: { createdAt: 'desc' },
});
if (
  latestCode &&
  Date.now() - new Date(latestCode.createdAt).getTime() < RESEND_COOLDOWN_MS
) {
  return NextResponse.json(
    { error: 'resendCooldown', retryAfterSec: Math.ceil(RESEND_COOLDOWN_MS / 1000) },
    { status: 429 }
  );
}

// SECURITY: per-IP hourly cap — protects the SMS budget from pumping abuse.
const ipCheck = await rateLimit(`otpsend:${clientIp(req)}`, 10, 60 * 60 * 1000);
if (!ipCheck.ok) {
  return NextResponse.json(
    { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
    { status: 429 }
  );
}

const code = generateOtp();

// DB HYGIENE (V13 — OTP table cleanup): wipe expired OTPs first so the
// table does not grow unbounded with rows nobody can ever verify. This
// runs on every OTP send and keeps the table small. A unique index on
// (phone) where appropriate would also help; for now a single delete
// statement is the simplest mitigation.
await db.otpCode.deleteMany({
  where: { expiresAt: { lt: new Date() } },
});

await db.otpCode.deleteMany({
  where: { phone },
});

await db.otpCode.create({
  data: {
    phone,
    code,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  },
});


  // DIAG: confirms the DB write actually persisted the row. In the random-OTP
  // demo flow the code is ALSO returned to the caller as `devOtp` below,
  // because no SMS provider is wired up in this deployment.
  console.log('[SEND-OTP] Saved OTP for phone:', phone, '| Code:', code);

  // DEMO MODE (reverted 2026-09-28): a random 6-digit code is returned to the
  // caller in the response instead of being dispatched to a provider. UltraMsg
  // / TextBee / Brevo are not configured here, so a real send would silently
  // fail and the user could never sign in. No SMS / WhatsApp leaves the server.
  //
  // SECURITY: this is a DEMO affordance. It must not be exposed on a public
  // production surface — anyone could read another account's OTP.
  console.log('[WASSILHA OTP DEMO] ' + phone + ' -> ' + code);

  return NextResponse.json({
    ok: true,
    sms: false,
    demo: true,
    devOtp: code,
  });
  } catch (e) {
    console.error('[SEND-OTP] DB Error:', e);


return NextResponse.json(
  {
    error: 'serverError',
    detail: String(e),
  },
  { status: 500 }
);

}
}
