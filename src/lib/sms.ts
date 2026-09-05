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

// WhatsApp API integration.
//
// This is provider-agnostic on purpose: the same code path works with
// Ultramsg, Wati, Meta Cloud API, Twilio, or any other gateway that
// exposes a JSON POST endpoint taking a body and an auth token. The
// caller configures the exact URL and token via env vars:
//
//   WHATSAPP_API_URL   e.g. https://api.ultramsg.com/instance123/messages/chat
//   WHATSAPP_API_TOKEN the bearer / x-token the gateway expects
//   WHATSAPP_AUTH_HEADER  optional. Defaults to "Authorization: Bearer".
//                        Set to "x-token" for Ultramsg/Wati.
//
// The body is sent as JSON: { to: <recipient>, body: <content> }. If
// the customer's gateway expects different field names, they can wrap
// it in their own proxy and point WHATSAPP_API_URL at the proxy.
//
// We never return the recipient's phone number or the OTP code in the
// SmsResult — only the provider name and the gateway's raw response.
async function sendWithWhatsApp(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const url = process.env.WHATSAPP_API_URL;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!url || !token) {
    throw new Error('WHATSAPP_API_URL or WHATSAPP_API_TOKEN is missing');
  }

  // Some gateways (Ultramsg, Wati) want a custom header name. We let
  // the operator pick. Anything else falls back to standard
  // Authorization: Bearer <token>.
  const authHeaderName = process.env.WHATSAPP_AUTH_HEADER || 'Authorization';
  const isBearer =
    authHeaderName.toLowerCase() === 'authorization' ||
    !process.env.WHATSAPP_AUTH_HEADER;
  const authHeaderValue = isBearer ? `Bearer ${token}` : token;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      [authHeaderName]: authHeaderValue,
    },
    body: JSON.stringify({
      // Most providers accept `to` and `body` (Ultramsg / Wati use
      // `body`; Meta Cloud uses `text`; the simple common form wins
      // here — operators that need different fields can proxy).
      to: recipient.replace(/^\+/, ''),
      body: content,
    }),
  });

  const result = await parseResponse(response);

  if (!response.ok) {
    throw new Error(`WhatsApp HTTP ${response.status}: ${JSON.stringify(result)}`);
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