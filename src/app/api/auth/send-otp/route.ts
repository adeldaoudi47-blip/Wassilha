import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendSms } from '@/lib/sms';
import { rateLimit, clientIp } from '@/lib/rate-limit';

const PHONE_RE = /^0[567]\d{8}$/;

// Matches the 30s resend timer already enforced by the frontend UI.
const RESEND_COOLDOWN_MS = 30 * 1000;

function generateOtp() {
return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
try {
const { phone } = await req.json();

if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
  return NextResponse.json(
    { error: 'invalidPhone' },
    { status: 400 }
  );
}

// SECURITY: demo mode can never activate in a production build, even if
// OTP_DEMO_MODE is mistakenly configured on the hosting provider.
const demoMode = process.env.OTP_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
const demoOtp = process.env.DEMO_OTP || '0000';

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

const code = demoMode ? demoOtp : generateOtp();

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

if (demoMode) {
  console.log('[WASSILHA OTP DEMO] ' + phone + ' -> ' + code);

  return NextResponse.json({
    ok: true,
    devOtp: code,
    demo: true,
  });
}

const recipient = '+213' + phone.substring(1);
const content = 'رمز الدخول الخاص بك في وصّلها هو: ' + code;

console.log('[WASSILHA SMS] Sending OTP...');
console.log('[WASSILHA SMS] Recipient: ' + recipient);
const sms = await sendSms(recipient, content);

console.log('[WASSILHA SMS] Provider: ' + sms.provider);
console.log('[WASSILHA SMS] SMS accepted by provider.');

return NextResponse.json({
  ok: true,
  sms: true,
  provider: sms.provider,
  result: sms.response,
});

} catch (e) {
console.error('[WASSILHA SMS] Server error:', e);

return NextResponse.json(
  {
    error: 'serverError',
    detail: String(e),
  },
  { status: 500 }
);

}
}