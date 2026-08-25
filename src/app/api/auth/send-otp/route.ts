import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendSms } from '@/lib/sms';

const PHONE_RE = /^0[567]\d{8}$/;

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

const demoMode = process.env.OTP_DEMO_MODE === 'true';
const demoOtp = process.env.DEMO_OTP || '0000';

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