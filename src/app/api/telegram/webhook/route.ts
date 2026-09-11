// WASSILHA Telegram AI-agent webhook.
//
// Telegram forwards every update (message) to this endpoint as a JSON POST:
//   { update_id, message: { chat: { id }, text, ... } }
// Non-text updates (photos, stickers, edited messages, ...) are ACKed with
// 200 and ignored. Text is answered by the shared Gemini brain
// (src/lib/ai-agent.ts) and the reply is sent back with
// sendTelegramMessage (src/lib/telegram.ts).
//
// Env vars (Vercel):
//   TELEGRAM_BOT_TOKEN       - from BotFather
//   TELEGRAM_WEBHOOK_SECRET  - optional; when set, the X-Telegram-Bot-Api-
//                              Secret-Token header sent by Telegram must match.
import { NextRequest, NextResponse, after } from 'next/server';
import { aiAgentReply } from '@/lib/ai-agent';
import { sendTelegramMessage } from '@/lib/telegram';

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    text?: string;
  };
};

// Best-effort duplicate suppression. Telegram redelivers unacknowledged
// updates; the Set is per-instance only, but removes common double-replies.
const seenUpdateIds = new Set<string>();
function alreadySeen(id: string): boolean {
  if (seenUpdateIds.has(id)) return true;
  seenUpdateIds.add(id);
  // Keep the set bounded in long-lived dev servers.
  if (seenUpdateIds.size > 500) {
    const first = seenUpdateIds.values().next().value;
    if (first) seenUpdateIds.delete(first);
  }
  return false;
}

// Health check / webhook-info helper (harmless; Telegram never calls GET).
export async function GET() {
  return NextResponse.json({ ok: true, service: 'telegram-agent' });
}

export async function POST(req: NextRequest) {
  // Optional shared-secret verification (setWebhook secret_token).
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    secret &&
    req.headers.get('x-telegram-bot-api-secret-token') !== secret
  ) {
    return NextResponse.json({ error: 'invalidSecret' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();

  // Photos, stickers, channel posts, edited messages, ... — ACK 200, ignore.
  if (!msg || chatId === undefined || !text) {
    return NextResponse.json({ ok: true });
  }
  if (update.update_id !== undefined && alreadySeen(String(update.update_id))) {
    return NextResponse.json({ ok: true });
  }

  // DEBUG: fires as soon as chatId + text are successfully extracted.
  console.log('[TELEGRAM WEBHOOK] Received message:', chatId, ':', text);

  // Answer Telegram fast; the (slow) AI work happens after the response.
  after(async () => {
    try {
      // The agent's getOrderStatus tool needs a Wassilha-registered phone;
      // on Telegram we only have the chat id. If the user asks about an
      // order, Gemini will ask for their phone in the chat and then call
      // the tool with it.
      const reply = await aiAgentReply(text, String(chatId));
      await sendTelegramMessage(chatId, reply);
      console.log('[TELEGRAM WEBHOOK] Reply sent to', chatId);
    } catch (e) {
      console.error('[TELEGRAM WEBHOOK] Failed to process update:', e);
    }
  });

  return NextResponse.json({ ok: true });
}