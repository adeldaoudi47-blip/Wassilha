// WASSILHA WhatsApp AI-agent webhook (Meta WhatsApp Cloud API).
//
//   GET  -> Meta subscription handshake (hub.challenge echo).
//   POST -> inbound user messages. Ack 200 immediately, then process
//           (Gemini + Prisma + reply) inside `after()` so Meta's 20s
//           webhook timeout is never hit.
//
// Env vars (Vercel):
//   META_WHATSAPP_VERIFY_TOKEN    - the value pasted in Meta's webhook setup
//   META_WHATSAPP_APP_SECRET      - optional, enables X-Hub-Signature-256 check
//   GEMINI_API_KEY                - Google AI Studio key (ai-agent.ts)
//   META_WHATSAPP_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID - reply sending (sms.ts)
import crypto from 'crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { aiAgentReply } from '@/lib/ai-agent';
import { sendMetaWhatsAppMessage } from '@/lib/sms';
import { normalizeAlgerianPhone } from '@/lib/phone';

// --- GET: webhook verification ----------------------------------------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token');
  const challenge = sp.get('hub.challenge');

  if (
    mode === 'subscribe' &&
    token &&
    challenge &&
    token === process.env.META_WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

// --- POST: inbound messages --------------------------------------------------

type MetaInboundMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
};

type MetaWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: MetaInboundMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
};

// Optional but recommended: verify the request really came from Meta by
// checking the X-Hub-Signature-256 HMAC. Skipped when the secret is not
// configured so local/dev testing stays frictionless.
function verifyMetaSignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!header || !header.startsWith('sha256=')) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Best-effort duplicate suppression. Meta redelivers unacknowledged webhooks;
// the Set is per-instance only, but that removes the common double-reply.
const seenMessageIds = new Set<string>();
function alreadySeen(id: string): boolean {
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  // Keep the set bounded in long-lived dev servers.
  if (seenMessageIds.size > 500) {
    const first = seenMessageIds.values().next().value;
    if (first) seenMessageIds.delete(first);
  }
  return false;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'invalidSignature' }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(raw) as MetaWebhookBody;
  } catch {
    return NextResponse.json({ error: 'badRequest' }, { status: 400 });
  }

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const text = message?.text?.body?.trim();
  const rawFrom = message?.from;

  // Delivery/read receipts and non-text messages (audio, images, ...):
  // acknowledge with 200 so Meta stops retrying, nothing to answer yet.
  if (!message || !text || !rawFrom) {
    return NextResponse.json({ ok: true });
  }
  if (message.id && alreadySeen(message.id)) {
    return NextResponse.json({ ok: true });
  }

  // Meta sends the sender as international digits WITHOUT '+' (2135XXXXXXXX).
  // Normalize to the canonical local form (0XXXXXXXXX) used across the app:
  // the DB lookup (User.phone) and the reply path both rely on it.
  const phone = normalizeAlgerianPhone(rawFrom);
  if (!phone) {
    // Non-Algerian number: acknowledge, but the agent only serves +213 users.
    console.warn('[WHATSAPP WEBHOOK] Unsupported sender number:', rawFrom);
    return NextResponse.json({ ok: true });
  }

  // Answer Meta fast; the (slow) AI work happens after the response.
  after(async () => {
    try {
      console.log('[WHATSAPP WEBHOOK] Message from', phone, ':', text);
      const reply = await aiAgentReply(text, phone);
      await sendMetaWhatsAppMessage(phone, reply);
      console.log('[WHATSAPP WEBHOOK] Reply sent to', phone);
    } catch (e) {
      console.error('[WHATSAPP WEBHOOK] Failed to process message:', e);
    }
  });

  return NextResponse.json({ ok: true });
}