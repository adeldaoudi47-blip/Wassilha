// WASSILHA Telegram bot — outbound helpers.
//
// Uses the official Bot API (api.telegram.org) with the token from
// BotFather (env: TELEGRAM_BOT_TOKEN). Inbound updates arrive at
// /api/telegram/webhook and are answered by the same Gemini brain the
// WhatsApp agent uses (src/lib/ai-agent.ts).
import { WELCOME_MESSAGE, ROLE_BUTTONS } from './ai-agent';

const API_ROOT = 'https://api.telegram.org';

type TelegramApiResponse = { ok?: boolean; description?: string } | null;

export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<{ ok: boolean }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing');
  }

  console.log('[TELEGRAM SEND] Sending reply to:', chatId, '| Message:', text);

  const post = async (parseMode?: string): Promise<Response> =>
    fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });

  let response: Response;
  try {
    // Markdown gives the replies nice bold/italic formatting, but Telegram
    // rejects (400) messages with unbalanced markdown entities — and the
    // AI output is free-form text. Try Markdown first, then fall back to
    // plain text so the user ALWAYS gets the answer.
    response = await post('Markdown');
  } catch (networkError) {
    console.error('[TELEGRAM SEND] Error:', networkError);
    throw networkError;
  }

  let result: TelegramApiResponse = null;
  try {
    result = (await response.json()) as TelegramApiResponse;
  } catch {
    /* non-JSON body — handled below */
  }

  if (!response.ok || !result?.ok) {
    console.warn(
      '[TELEGRAM SEND] Markdown send failed (',
      result?.description ?? response.status,
      ') — retrying as plain text.'
    );
    try {
      response = await post(undefined);
      try {
        result = (await response.json()) as TelegramApiResponse;
      } catch {
        /* handled below */
      }
    } catch (networkError) {
      console.error('[TELEGRAM SEND] Error (plain-text retry):', networkError);
      throw networkError;
    }
  }

  if (!response.ok || !result?.ok) {
    const msg = `Telegram HTTP ${response.status}: ${JSON.stringify(result)}`;
    console.error('[TELEGRAM SEND] Error:', msg);
    throw new Error(msg);
  }

  return { ok: true };
}

// Role-choice keyboard: a permanent reply keyboard pinned under the chat
// so the user can tap their role at any time (not just the first message).
export async function sendTelegramWelcome(
  chatId: string | number
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing');
  }

  console.log('[TELEGRAM SEND] Sending promotional welcome to:', chatId);

  const post = async (parseMode?: string): Promise<Response> =>
    fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: WELCOME_MESSAGE,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        reply_markup: {
          keyboard: [ROLE_BUTTONS.map((label) => ({ text: label }))],
          resize_keyboard: true,
          is_persistent: true,
        },
      }),
    });

  let response: Response;
  try {
    response = await post('Markdown');
  } catch (networkError) {
    console.error('[TELEGRAM SEND] Error (welcome):', networkError);
    throw networkError;
  }

  let result: TelegramApiResponse = null;
  try {
    result = (await response.json()) as TelegramApiResponse;
  } catch {
    /* handled below */
  }

  // Markdown leftovers in the static text are unlikely but possible after
  // future edits — fall back to plain text, keeping the keyboard.
  if (!response.ok || !result?.ok) {
    try {
      response = await post(undefined);
      try {
        result = (await response.json()) as TelegramApiResponse;
      } catch {
        /* handled below */
      }
    } catch (networkError) {
      console.error('[TELEGRAM SEND] Error (welcome plain retry):', networkError);
      throw networkError;
    }
  }

  if (!response.ok || !result?.ok) {
    const msg = `Telegram HTTP ${response.status}: ${JSON.stringify(result)}`;
    console.error('[TELEGRAM SEND] Error (welcome):', msg);
    throw new Error(msg);
  }
}