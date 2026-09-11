// WASSILHA AI AGENT — the "brain" behind the WhatsApp/Telegram assistants.
//
// Architecture:
//   /api/whatsapp/webhook | /api/telegram/webhook -> aiAgentReply()
//   -> MULTI-PROVIDER FALLBACK: Groq -> OpenRouter -> Gemini -> busy msg
//   -> Function Calling (same 2 tools everywhere)
//   -> Prisma queries (live app data) -> final text reply.
//
// The model can answer general questions about Wassilha from the system
// prompt alone, and calls tools when it needs live data:
//   - getOrderStatus: latest WS (delivery) + HIRFA (craft) order for a phone.
//   - getCraftProducts: newest 5 active craft-marketplace products.
import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
} from '@google/generative-ai';
import { db } from '@/lib/db';
import { normalizeAlgerianPhone } from '@/lib/phone';

// Model selection: Google RETIRED the whole gemini-1.5 family (the old
// "gemini-1.5-flash" name now 404s with "not found for API version
// v1beta"). "gemini-flash-latest" is Google's maintained alias that
// always points at the current stable Flash model, so it keeps working
// across future model rotations. Operators can override it per-deploy
// with GEMINI_MODEL (e.g. "gemini-2.5-flash", "gemini-pro").
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_TOOL_ROUNDS = 3; // hard stop so a looping model can't burn quota

const SYSTEM_PROMPT = `أنت المساعد الذكي لتطبيق وصّلها (Wassilha)، تطبيق جزائري للتوصيل ونقل الركاب وسوق الحرفيين (حِرفة).

مهامك:
- شرح كيفية التسجيل (برقم الهاتف الجزائري 05/06/07 ثم رمز تحقق OTP).
- معلومات التوصيل: أنواع الحمولة (طرد، بضائع، أثاث، مواد بناء...)، الأسعار تُحسب حسب المسافة والوزن ونوع الحمولة.
- الاستعلام عن حالة الطلب: استخدم الأداة getOrderStatus عندما يسأل المستخدم عن طلباته (طلبات التوصيل أكوادها WS-XXXXX وطلبات حِرفة أكوادها HIRFA-XXXXX).
- عرض منتجات حِرفة: استخدم الأداة getCraftProducts عندما يطلب المستخدم رؤية المنتجات أو يسأل "ما الجديد؟".
- حالات الطلبات: التوصيل = searching | scheduled | accepted | picked | delivered | cancelled، وحِرفة = pending | confirmed | ready | delivered | cancelled.

قواعد صارمة:
- كن لطيفاً ومختصراً (2-4 جمل كحد أقصى، إلا عند عرض منتجات/طلبات).
- رد بالعربية أو الفرنسية حسب لغة رسالة المستخدم.
- لا تخترع أكواد طلبات أو أسعاراً: الأسعار والطلبات تأتي فقط من الأدوات.
- لا تشارك بيانات مستخدم آخر ولا معلومات حساسة (أرقام هواتف السائقين، إلخ).
- إذا لم تعرف الإجابة، اقترح مراسلة فريق الدعم داخل التطبيق.`;

const FALLBACK_REPLY =
  'مرحباً بك في وصّلها! 👋\nيمكنني مساعدتك في: حالة طلبك، أسعار التوصيل، ومتجر حِرفة للحرفيين.\n' +
  'Bienvenue sur Wassilha ! Je peux vous aider : statut de commande, tarifs de livraison, et le marché artisanal HIRFA.';

// Returned only when EVERY provider in the chain failed.
const BUSY_MESSAGE = 'أنا مشغول حالياً، يرجى إعادة المحاولة بعد قليل.';

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'getOrderStatus',
    description:
      'يستعلم عن آخر طلبات المستخدم: آخر طلب توصيل (WS) وآخر طلب حِرفة (HIRFA) وحالتهما الحالية. استخدمها دائماً عندما يسأل المستخدم عن حالة طلبه. مرر رقم هاتف المرسل كما هو.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        phone: {
          type: SchemaType.STRING,
          description: 'رقم هاتف المستخدم المرسل (بالصيغة المحلية 0XXXXXXXXX أو الدولية).',
        },
      },
      required: ['phone'],
    },
  },
  {
    name: 'getCraftProducts',
    description:
      'يعرض أحدث 5 منتجات نشطة في سوق الحرفيين "حِرفة" مع الاسم والسعر والمخزون واسم الحرفي. لا يحتاج أي معطيات.',
  },
];

// --- Tool implementations (Prisma) -----------------------------------------

async function toolGetOrderStatus(args: {
  phone?: unknown;
}): Promise<Record<string, unknown>> {
  const phone = normalizeAlgerianPhone(typeof args.phone === 'string' ? args.phone : '');
  if (!phone) return { found: false, reason: 'invalid_phone' };

  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, name: true },
  });
  if (!user) return { found: false, reason: 'user_not_found' };

  const [lastDelivery, lastCraft] = await db.$transaction([
    db.order.findFirst({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        code: true,
        status: true,
        pickup: true,
        dropoff: true,
        price: true,
        createdAt: true,
        deliveredAt: true,
      },
    }),
    db.craftOrder.findFirst({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        code: true,
        status: true,
        totalPrice: true,
        deliveryOption: true,
        createdAt: true,
        deliveredAt: true,
        artisan: { select: { displayName: true } },
        items: {
          select: { quantity: true, product: { select: { nameAr: true } } },
        },
      },
    }),
  ]);

  return {
    found: true,
    customerName: user.name,
    lastDeliveryOrder: lastDelivery,
    lastCraftOrder: lastCraft,
    statusLegend: {
      delivery:
        'searching=جاري البحث عن سائق, scheduled=مجدول, accepted=قبل السائق, picked=تم الاستلام, delivered=تم التوصيل, cancelled=ملغى',
      craft: 'pending=بانتظار تأكيد الحرفي, confirmed=مؤكد, ready=جاهز للتوصيل, delivered=تم التوصيل, cancelled=ملغى',
    },
  };
}

async function toolGetCraftProducts(): Promise<Record<string, unknown>> {
  const products = await db.craftProduct.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      nameAr: true,
      nameFr: true,
      price: true,
      stock: true,
      category: { select: { nameAr: true, nameFr: true } },
      artisan: { select: { displayName: true } },
    },
  });
  return { count: products.length, products };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    if (name === 'getOrderStatus') {
      return await toolGetOrderStatus(args as { phone?: unknown });
    }
    if (name === 'getCraftProducts') {
      return await toolGetCraftProducts();
    }
    return { error: 'unknown_tool' };
  } catch (e) {
    console.error('[AI AGENT] Tool failed:', name, e);
    return { error: 'tool_failed' };
  }
}

// --- Providers: Groq / OpenRouter (OpenAI-compatible, plain fetch) ----------

// OpenAI-compatible tool schema — Groq and OpenRouter both expose the
// OpenAI /chat/completions contract. Same two tools as the Gemini
// declarations above.
const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'getOrderStatus',
      description:
        'يستعلم عن آخر طلبات المستخدم: آخر طلب توصيل (WS) وآخر طلب حِرفة (HIRFA) وحالتهما الحالية. استخدمها دائماً عندما يسأل المستخدم عن حالة طلبه. مرر رقم هاتف المرسل كما هو.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description:
              'رقم هاتف المستخدم المرسل (بالصيغة المحلية 0XXXXXXXXX أو الدولية).',
          },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getCraftProducts',
      description:
        'يعرض أحدث 5 منتجات نشطة في سوق الحرفيين "حِرفة" مع الاسم والسعر والمخزون واسم الحرفي. لا يحتاج أي معطيات.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

// Shared function-calling loop for every OpenAI-compatible provider.
// Throws on transport/API failure so the caller can fall through to the
// next provider in the chain.
async function runOpenAICompatible(
  providerName: string,
  apiUrl: string,
  apiKey: string,
  model: string,
  userText: string,
  phone: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const messages: OpenAIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${userText}\n\n(رقم هاتف المرسل: ${phone} — مرره كما هو إذا استدعيت getOrderStatus)`,
    },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        messages,
        tools: OPENAI_TOOLS,
        temperature: 0.6,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      throw new Error(`${providerName} HTTP ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${providerName} returned no choices`);

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });
      for (const call of message.tool_calls) {
        console.log(
          `[AI AGENT] ${providerName} requested tool:`,
          call.function?.name
        );
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}') as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const result = await executeTool(call.function?.name ?? '', args);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // feed tool results back so the model composes the answer
    }

    const reply = (message.content ?? '').trim();
    console.log(`[AI AGENT] ${providerName} response:`, reply);
    return reply || FALLBACK_REPLY;
  }

  // Model kept calling tools past the cap — static fallback.
  return FALLBACK_REPLY;
}

async function runGroq(userText: string, phone: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  return runOpenAICompatible(
    'Groq',
    'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    userText,
    phone
  );
}

async function runOpenRouter(userText: string, phone: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');
  return runOpenAICompatible(
    'OpenRouter',
    'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
    userText,
    phone,
    // OpenRouter recommends identifying the app (free tier courtesy rules).
    { 'X-Title': 'Wassilha' }
  );
}

// --- Public entry point ------------------------------------------------------

// Gemini (the original SDK path). Throws so the chain can continue.
async function runGemini(userText: string, phone: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: toolDeclarations }],
  });

  const chat = model.startChat();
  let result = await chat.sendMessage(
    `${userText}\n\n(رقم هاتف المرسل: ${phone} — مرره كما هو إذا استدعيت getOrderStatus)`
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) {
      const reply = result.response.text();
      console.log('[AI AGENT] Gemini response:', reply);
      return reply && reply.trim() ? reply.trim() : FALLBACK_REPLY;
    }

    const parts: Array<{
      functionResponse: { name: string; response: Record<string, unknown> };
    }> = [];
    for (const call of calls) {
      console.log('[AI AGENT] Gemini requested tool:', call.name);
      const response = await executeTool(
        call.name,
        (call.args ?? {}) as Record<string, unknown>
      );
      parts.push({ functionResponse: { name: call.name, response } });
    }
    result = await chat.sendMessage(parts);
  }

  const last = result.response.text();
  return last && last.trim() ? last.trim() : FALLBACK_REPLY;
}

/**
 * Takes an inbound message (already normalized phone/chat id + raw text)
 * and returns the final assistant reply, trying providers in order:
 *   Groq -> OpenRouter -> Gemini -> BUSY_MESSAGE.
 * Every provider runs the SAME system prompt and the SAME two Prisma tools.
 */
export async function aiAgentReply(
  userText: string,
  phone: string
): Promise<string> {
  const text = userText.trim();
  if (!text) return FALLBACK_REPLY;

  const chain: Array<{
    name: string;
    run: (t: string, p: string) => Promise<string>;
  }> = [];
  if (process.env.GROQ_API_KEY) chain.push({ name: 'Groq', run: runGroq });
  if (process.env.OPENROUTER_API_KEY)
    chain.push({ name: 'OpenRouter', run: runOpenRouter });
  if (process.env.GEMINI_API_KEY)
    chain.push({ name: 'Gemini', run: runGemini });

  if (chain.length === 0) {
    console.error('[AI AGENT] No provider API keys configured.');
    return BUSY_MESSAGE;
  }

  for (const provider of chain) {
    console.log('[AI AGENT] Trying provider:', provider.name);
    try {
      return await provider.run(text, phone);
    } catch (e) {
      console.error(`[AI AGENT] Provider ${provider.name} failed:`, e);
    }
  }

  console.error('[AI AGENT] All providers failed — returning busy message.');
  return BUSY_MESSAGE;
}