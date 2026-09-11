// WASSILHA WhatsApp AI-agent webhook — UltraMsg gateway edition.
//
// UltraMsg (already used for the OTPs) is also the inbound gateway for the
// AI assistant: the instance forwards every received message to this
// endpoint as a JSON POST. There is NO Meta-style handshake (hub.challenge)
// to implement — GET is just a plain health check.
//
// Env vars (Vercel):
//   WHATSAPP_API_URL / WHATSAPP_API_TOKEN - UltraMsg instance (send + receive)
//   GEMINI_API_KEY                        - Google AI Studio key (ai-agent.ts)
import { NextRequest, NextResponse, after } from 'next/server';
import { aiAgentReply, isGreeting, WELCOME_MESSAGE, ROLE_BUTTONS } from '@/lib/ai-agent';
import { sendWhatsAppMessage } from '@/lib/sms';
import { normalizeAlgerianPhone } from '@/lib/phone';

// --- GET: plain health check ------------------------------------------------

export async function GET() {
  return NextResponse.json({ ok: true, service: 'whatsapp-agent' });
}

// --- POST: inbound messages --------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// UltraMsg (and similar gateways) have shipped several slightly different
// webhook shapes over the years, so look in all the observed places
// instead of betting on a single one:
//   { from, body }                             (flat)
//   { data: { from, body, chatId, id } }       (UltraMsg current)
//   { message: { from, text: { body } } }      (Meta-like)
//   { message: 'some text' }                   (string shortcut)
//   { from, phone, text, body, event_type, ... }
function extractSenderAndText(payload: unknown): {
  fromRaw: string | null;
  text: string | null;
  id: string | null;
} {
  const root = (payload ?? {}) as UnknownRecord;
  const data = (root.data ?? {}) as UnknownRecord;
  const msg = (
    typeof root.message === 'object' && root.message !== null ? root.message : {}
  ) as UnknownRecord;

  const fromRaw =
    asString(root.from) ??
    asString(root.phone) ??
    asString(root.sender) ??
    asString(root.chatId) ??
    asString(data.from) ??
    asString(data.chatId) ??
    asString(data.phone) ??
    asString(msg.from);

  const text =
    asString(root.body) ??
    asString(root.text) ??
    asString(data.body) ??
    asString(data.text) ??
    asString(msg.body) ??
    asString((msg.text as UnknownRecord | undefined)?.body) ??
    (typeof root.message === 'string' && root.message.trim()
      ? root.message.trim()
      : null);

  const id = asString(root.id) ?? asString(data.id) ?? asString(msg.id);

  return { fromRaw, text, id };
}

// Best-effort duplicate suppression. Gateways redeliver on timeout; the
// Set is per-instance only, but that removes the common double-reply.
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
  // Read the raw body once, then parse: JSON first (UltraMsg default),
  // falling back to form-urlencoded (some instance configurations).
  const raw = await req.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = Object.fromEntries(new URLSearchParams(raw).entries());
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ ok: true });
  }

  const { fromRaw, text, id } = extractSenderAndText(payload);

  // Delivery/read receipts and non-text events carry no text —
  // acknowledge with 200 so the gateway stops retrying.
  if (!fromRaw || !text) {
    return NextResponse.json({ ok: true });
  }
  if (id && alreadySeen(id)) {
    return NextResponse.json({ ok: true });
  }

  // UltraMsg sends the sender like `+213XXXXXXXXX` / `213XXXXXXXXX` /
  // `213XXXXXXXXX@c.us`. Strip any JID suffix, keep digits, then normalize
  // to the canonical local form (0XXXXXXXXX) used across the app.
  const digits = fromRaw.replace(/@.*$/, '').replace(/\D/g, '');
  const phone = normalizeAlgerianPhone(digits);
  if (!phone) {
    console.warn('[WHATSAPP WEBHOOK] Unsupported sender number:', fromRaw);
    return NextResponse.json({ ok: true });
  }

  // DEBUG: fires as soon as sender + text are successfully extracted.
  console.log('[WHATSAPP WEBHOOK] Received message:', phone, ':', text);

  // Answer fast; the (slow) AI work happens after the response.
  after(async () => {
    try {
      // Greetings get the STATIC promotional welcome. UltraMsg has no
      // reliable WhatsApp buttons, so the three role choices are appended
      // as numbered plain-text options.
      if (isGreeting(text)) {
        const options = ROLE_BUTTONS.map(
          (label, i) => `${i + 1}) ${label.slice(label.indexOf(' ') + 1)}`
        ).join('\n');
        await sendWhatsAppMessage(
          phone,
          `${WELCOME_MESSAGE}\n${options}`
        );
        console.log('[WHATSAPP WEBHOOK] Welcome sent to', phone);
        return;
      }
      const reply = await aiAgentReply(text, phone);
      await sendWhatsAppMessage(phone, reply);
      console.log('[WHATSAPP WEBHOOK] Reply sent to', phone);
    } catch (e) {
      console.error('[WHATSAPP WEBHOOK] Failed to process message:', e);
    }
  });

  return NextResponse.json({ ok: true });
}