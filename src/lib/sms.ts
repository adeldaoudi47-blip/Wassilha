type SmsProvider = 'textbee' | 'brevo';

type SmsResult = {
  provider: SmsProvider;
  response: unknown;
};

function configuredProvider(name: string | undefined): SmsProvider | null {
  if (name === 'textbee' || name === 'brevo') return name;
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

export async function sendSms(
  recipient: string,
  content: string
): Promise<SmsResult> {
  const primary = configuredProvider(process.env.SMS_PROVIDER) || 'brevo';
  const fallback = configuredProvider(process.env.SMS_FALLBACK_PROVIDER);

  try {
    return primary === 'textbee'
      ? await sendWithTextBee(recipient, content)
      : await sendWithBrevo(recipient, content);
  } catch (primaryError) {
    if (!fallback || fallback === primary) throw primaryError;

    console.error(
      `[WASSILHA SMS] ${primary} failed; trying ${fallback}:`,
      primaryError
    );

    return fallback === 'textbee'
      ? await sendWithTextBee(recipient, content)
      : await sendWithBrevo(recipient, content);
  }
}