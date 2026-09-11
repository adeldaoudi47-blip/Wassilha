import { normalizeAlgerianPhone } from './phone';

type SmsProvider = 'textbee' | 'brevo' | 'whatsapp';

type SmsResult = {
  provider: SmsProvider;
  response: unknown;
};

function configuredProvider(name: string | undefined): SmsProvider | null {
  if (name === 'textbee' || name === 'brevo' || name === 'whatsapp') return name;
  return null;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendWithTextBee(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const apiKey = process.env.TEXTBEE_API_KEY;

  if (!apiKey) {
    throw new Error('TEXTBEE_API_KEY is missing');
  }

  const response = await fetch(
    'https://api.textbee.dev/api/v1/gateway/send-sms',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        recipients: [recipient],
        message: content,
        ...(process.env.TEXTBEE_DEVICE_ID
          ? { deviceId: process.env.TEXTBEE_DEVICE_ID }
          : {}),
      }),
    }
  );

  const result = await parseResponse(response);

  if (!response.ok) {
    throw new Error(`TextBee HTTP ${response.status}: ${JSON.stringify(result)}`);
  }

  // TextBee may return 200 OK with success=false in the body when the
  // underlying Android device is offline, the deviceId is wrong, or the
  // content was rejected. Without this check the API would silently claim
  // success and the user would never receive the SMS. Throw so the caller
  // can either fall back to Brevo or surface a serverError to the user.
  const body = result as
    | { data?: { success?: boolean; message?: string } }
    | null;
  if (body && body.data && body.data.success === false) {
    throw new Error('TextBee device offline or rejected the request');
  }

  return { provider: 'textbee', response: result };
}

async function sendWithBrevo(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    throw new Error('BREVO_API_KEY is missing');
  }

  const response = await fetch(
    'https://api.brevo.com/v3/transactionalSMS/send',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'WASSILHA',
        recipient: recipient.replace(/^\+/, ''),
        content,
        type: 'transactional',
        unicodeEnabled: true,
      }),
    }
  );

  const result = await parseResponse(response);

  if (!response.ok) {
    throw new Error(`Brevo HTTP ${response.status}: ${JSON.stringify(result)}`);
  }

  return { provider: 'brevo', response: result };
}

// WhatsApp API integration — UltraMsg-compatible.
//
// We hard-code the UltraMsg /messages/chat contract here because the
// real deployment is wired to UltraMsg (Vercel env vars). The contract
// is documented at https://docs.ultramsg.com/ and differs from a
// generic JSON gateway in two important ways:
//
//   1. The auth token is sent in the REQUEST BODY (`token=...`) and
//      optionally also as a `?token=...` query string. There is no
//      `Authorization: Bearer` header — UltraMsg ignores it and the
//      instance is then seen as unauthenticated.
//
//   2. The body is form-urlencoded (`Content-Type:
//      application/x-www-form-urlencoded`), not JSON. Sending JSON
//      silently succeeds (200 OK) without actually dispatching the
//      message, which is exactly the failure mode we are fixing.
//
// UltraMsg success response:
//   { "sent": "true",  "message": "ok", "id": <msgId> }
//
// UltraMsg failure response (HTTP 200 but message NOT sent):
//   { "sent": "false", "error": "<reason>" }
//
// We MUST check `sent === 'true'`; relying on `response.ok` is not
// enough because UltraMsg always replies 200.
async function sendWithWhatsApp(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const url = process.env.WHATSAPP_API_URL;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!url || !token) {
    throw new Error('WHATSAPP_API_URL or WHATSAPP_API_TOKEN is missing');
  }

  // UltraMsg requires an international number with NO leading `+`,
  // NO spaces, and NO leading zero. Examples:
  //   recipient `+213562166355`  ->  `213562166355`  (correct)
  //   recipient `00213562166355` ->  `213562166355`  (correct)
  //   recipient `0562166355`     ->  `213562166355`  (we add 213)
  // The upstream code already feeds us a +213XXXXXXXXX form (built
  // in /api/auth/send-otp), so we strip the `+` here. We also keep a
  // defensive 213-prefix / 0-strip in case a future caller hands us
  // a different shape.
  let phone = recipient.replace(/[\s\-+]/g, '');
  if (phone.startsWith('00213')) phone = phone.slice(2);
  if (phone.startsWith('0')) phone = '213' + phone.slice(1);
  if (!/^213\d{9}$/.test(phone)) {
    throw new Error(
      `WhatsApp: phone number is not a valid Algerian international form (got "${recipient}", normalized "${phone}")`
    );
  }

  // Body: form-urlencoded. `token`, `to`, and `body` are the three
  // required fields per the UltraMsg docs. `priority` is an optional
  // hint and defaults to "1" on UltraMsg's side; we set it explicitly
  // so the operator can change it in one place if the instance is
  // throttled.
  const formBody = new URLSearchParams({
    token,
    to: phone,
    body: content,
    priority: '1',
  });

  // Some UltraMsg deployments accept the token in the query string
  // instead of the body. If the operator sets WHATSAPP_TOKEN_IN_QUERY
  // we add it as a query parameter and drop it from the body. This
  // is opt-in because it leaks the token to proxy/access logs more
  // easily than the body form.
  let targetUrl = url;
  if (process.env.WHATSAPP_TOKEN_IN_QUERY === 'true') {
    formBody.delete('token');
    const sep = url.includes('?') ? '&' : '?';
    targetUrl = `${url}${sep}token=${encodeURIComponent(token)}`;
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });
  } catch (networkError) {
    console.error('[Wassilha WhatsApp] Network error:', networkError);
    throw networkError;
  }

  const result = await parseResponse(response);

  if (!response.ok) {
    const msg = `WhatsApp HTTP ${response.status}: ${JSON.stringify(result)}`;
    console.error('[Wassilha WhatsApp] Error:', msg);
    throw new Error(msg);
  }

  // UltraMsg always replies 200 even when the message was not
  // actually queued (e.g. recipient is not on WhatsApp, instance is
  // disconnected, template mismatch, daily quota hit, etc.). The
  // authoritative signal is the `sent` field — must be the string
  // "true". Anything else (boolean false, missing, error string) is
  // a real failure that the user must be told about; otherwise we
  // would silently lose their OTP and the user is locked out.
  const body = (result ?? {}) as {
    sent?: string | boolean;
    error?: string;
    message?: string;
  };
  const sent = body.sent;
  if (sent !== true && sent !== 'true') {
    const reason =
      body.error ||
      (typeof body.message === 'string' ? body.message : null) ||
      'unknown UltraMsg failure (sent field is not "true")';
    const msg = `WhatsApp rejected the message: ${reason}`;
    console.error('[Wassilha WhatsApp] Error:', msg, '| raw response:', result);
    throw new Error(msg);
  }

  return { provider: 'whatsapp', response: result };
}

// Exposed helper so future call-sites (admin notifications, order
// status pings, etc.) can target WhatsApp without having to know the
// underlying provider. Goes through the same gateway as the OTP path
// so the deployment has a single integration to monitor.
export async function sendWhatsAppOtp(
  phone: string,
  code: string
): Promise<SmsResult> {
  // Normalize the phone to the E.164 form the SMS layer expects
  // (+213XXXXXXXXX). The input can be either the raw 10-digit local
  // form (0XXXXXXXXX) or already international.
  const recipient = phone.startsWith('+')
    ? phone
    : '+213' + phone.replace(/^0/, '');
  const content = `رمز الدخول الخاص بك في وصّلها هو: ${code}`;
  return sendWithWhatsApp(recipient, content);
}

export async function sendSms(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const primary = configuredProvider(process.env.SMS_PROVIDER) || 'brevo';
  const fallback = configuredProvider(process.env.SMS_FALLBACK_PROVIDER);

  // Single dispatch table so the try/catch + fallback chain stays
  // symmetric. Each provider exposes the same (recipient, content)
  // -> Promise<SmsResult> contract.
  type DispatchFn = (
    recipient: string,
    content: string
  ) => Promise<SmsResult>;
  const dispatch: Record<SmsProvider, DispatchFn> = {
    textbee: sendWithTextBee,
    brevo: sendWithBrevo,
    whatsapp: sendWithWhatsApp,
  };

  try {
    return await dispatch[primary](recipient, content);
  } catch (primaryError) {
    if (!fallback || fallback === primary) throw primaryError;

    console.error(
      `[WASSILHA SMS] ${primary} failed; trying ${fallback}:`,
      primaryError
    );

    return await dispatch[fallback](recipient, content);
  }
}

// --- UltraMsg reply sender (AI WhatsApp agent) -------------------------------
//
// The AI agent webhook (/api/whatsapp/webhook) replies through the SAME
// UltraMsg instance that receives inbound messages and delivers the OTPs:
// WHATSAPP_API_URL + WHATSAPP_API_TOKEN. One gateway to monitor, and no
// Meta Cloud API restrictions (dev mode / number whitelisting).
export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<SmsResult> {
  // Accepts any Algerian variant; canonicalize to local (0XXXXXXXXX) first
  // so the UltraMsg gateway gets the exact 213XXXXXXXXX form it expects.
  const local = normalizeAlgerianPhone(phone);
  if (!local) {
    throw new Error(`Invalid WhatsApp recipient: ${phone}`);
  }
  const recipient = '+213' + local.slice(1);

  console.log(
    '[ULTRAMSG SEND] Sending reply to:',
    recipient,
    '| Message:',
    message
  );

  // WhatsApp (UltraMsg) receives PLAIN text: strip any markdown leftovers
  // (**bold**, `code`, # headings) the model may emit, so the user never
  // sees raw formatting symbols. Telegram keeps real Markdown formatting.
  const plain = message
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`+/g, '')
    .replace(/^#{1,3}\s*/gm, '');

  try {
    return await sendWithWhatsApp(recipient, plain);
  } catch (e) {
    console.error('[ULTRAMSG SEND] Error:', e);
    throw e;
  }
}