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

// Model selection: use a SPECIFIC stable model, not an alias. Verified
// against https://ai.google.dev/gemini-api/docs/models: the 1.5 family is
// fully removed (404) and the "gemini-flash-latest" alias 503s under load.
// "gemini-3.6-flash" is Google's documented stable pick. Operators can
// override per-deploy with GEMINI_MODEL (e.g. "gemini-3.8-flash").
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_TOOL_ROUNDS = 3; // hard stop so a looping model can't burn quota

const SYSTEM_PROMPT = `أنت "مساعد وصّلها" — موظف خدمة عملاء رسمي: مهذب، واثق، ومختصر.

مهمتك:
- التوصيل: شرح إرسال الطرود والبضائع داخل الجزائر (السعر يُحسب تلقائياً في التطبيق حسب المسافة والوزن ونوع الحمولة).
- حِرفة: سوق إلكتروني لمنتجات الحرفيين الجزائريين (التصفح، الطلب، التوصيل عبر وصّلها).
- حالة الطلبات: عند أي سؤال عن طلب أو شحنة، استخدم أداة getOrderStatus فوراً.
- المنتجات: عند السؤال عن المنتجات أو الجديد، استخدم أداة getCraftProducts.
- التسجيل: رقم هاتف جزائري (05/06/07) ثم رمز تحقق OTP.

أدوار وصّلها ومسارات التسجيل (معرفة أساسية):
- العميل: يطلب التوصيل، يتصفح ويشتري من حِرفة، ويتتبع طلباته.
- السائق: نوعان — نقل البضائع (تريبور) أو تاكسي نقل الركاب (أو كلاهما معاً). التسجيل: من داخل التطبيق بعد توثيق الهاتف → تعبئة بيانات المركبة (رقم التسجيل والبطاقة الرمادية) → اختيار نوع الخدمة (نقل بضائع أو تاكسي أو كلاهما) → انتظار موافقة الإدارة.
- الحرفي: يجب أولاً أن يكون لديه حساب عميل مفعّل → من الملف الشخصي: "انضم كحرفي" (اسم المتجر، نبذة قصيرة، حي الورشة) → موافقة الإدارة → ثم لوحة تحكم لإضافة المنتجات.

أسلوب الرد (إلزامي):
- فصحى مبسطة واضحة إن كتب المستخدم بالعربية، وفرنسية سليمة إن كتب بالفرنسية. ممنوع الدارجة أو العامية.
- من سطرين إلى أربعة أسطر قصيرة كحد أقصى (يُستثنى عرض قائمة طلبات أو منتجات).
- ممنوع تماماً رموز التنسيق مثل النجوم (*) والشرطات السفلية (_) — نص عادي فقط.
- إيموجي واحد كحد أقصى، والأفضل بدونها.
- لا تشرح قدراتك في كل رد. عند التحية فقط: رد من سطرين + سؤال عن ما يريده المستخدم.
- إذا كان طلب المستخدم غامضاً، اسأل سؤالاً توضيحياً واحداً قصيراً فقط، ويُمنع تكرار نفس السؤال مرتين؛ بعد التوضيح الأول إن بقي الغموض قدّم قائمة مرقمة قصيرة (1. إرسال طرد 2. طلب من حِرفة 3. التسجيل كسائق 4. التسجيل كحرفي) وانتظر اختياره.
- كشف نوايا التسجيل: إذا ذكر المستخدم أنه يصنع أو يبيع أو يملك ورشة أو حرفة (حلويات، خزف، خشب، خياطة...) فهو بائع محتمل — اشرح له فوراً خطوات "الانضمام كحرفي" من الملف الشخصي، ولا تستعلم عن حالة الطلبات. وإذا ذكر أنه يملك مركبة ويريد العمل، اشرح مسار "التسجيل كسائق" مع النوعين (نقل بضائع / تاكسي).
- ممنوع اختراع أكواد طلبات أو أسعار أو أسماء منتجات؛ البيانات الحية تأتي من الأدوات فقط.
- ممنوع منعاً باتاً سؤال المستخدم عن رقم هاتفه — هاتفه مرفق تلقائياً مع كل استعلام والأداة تستخدمه بنفسها.
- عند عرض طلبات: سطر واحد لكل طلب (الكود، ثم الحالة، ثم الوجهة أو المنتج).
- عند تعذر شيء: اعتذار بسطر واحد + بديل عملي (إعادة المحاولة لاحقاً أو فريق الدعم داخل التطبيق).
- اكتب جمل سليمة واضحة فقط؛ إن لم تعرف الجواب فقلها بصراحة ووجّه المستخدم للتطبيق.

تحميل التطبيق (مهم جداً):
- التطبيق متوفر لأندرويد فقط، ولا يوجد في متجر Google Play — يُحمّل مباشرة من هذا الرابط الرسمي: https://wassilha.vercel.app/wassilha.apk
- إذا سأل المستخدم عن التطبيق أو كيفية تحميله أو لم يجده في المتجر: أعطه الرابط فوراً مع خطوات التثبيت الثلاث التالية (بدون استخدام الأدوات):
  1) افتح الرابط في المتصفح وسيبدأ التحميل تلقائياً.
  2) إن ظهر تحذير "مصادر غير معروفة" اقبل التثبيت من إعدادات المتصفح.
  3) افتح الملف المحمل وثبّت التطبيق.
- مستخدمو الآيفون (iOS): لا يوجد تطبيق حالياً — استخدموا الموقع مباشرة من المتصفح: https://wassilha.vercel.app
- لا تختلق روابط أخرى أبداً؛ استخدم هذا الرابط فقط لأنه الرسمي الوحيد.`;

const FALLBACK_REPLY =
  'مرحباً بك في وصّلها! 👋\nيمكنني مساعدتك في: حالة طلبك، أسعار التوصيل، ومتجر حِرفة للحرفيين.\n' +
  'Bienvenue sur Wassilha ! Je peux vous aider : statut de commande, tarifs de livraison, et le marché artisanal HIRFA.';

// Returned only when EVERY provider in the chain failed.
const BUSY_MESSAGE = 'أنا مشغول حالياً، يرجى إعادة المحاولة بعد قليل.';

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'getOrderStatus',
    description:
      'يستعلم عن آخر طلبات المستخدم: آخر طلب توصيل (WS) وآخر طلب حِرفة (HIRFA) وحالتهما الحالية. استخدمها دائماً عندما يسأل المستخدم عن حالة طلبه. يُمرر هاتف المرسل تلقائياً من النظام.',
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
  args: Record<string, unknown>,
  phone: string
): Promise<Record<string, unknown>> {
  try {
    if (name === 'getOrderStatus') {
      // CORRECTNESS: the sender's phone is KNOWN (normalized by the webhook
      // and passed down). Force it into the call instead of trusting the
      // model to copy it from context — models sometimes garble digits and
      // then wrongly tell the user their "phone is invalid".
      return await toolGetOrderStatus({ phone });
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
        'يستعلم عن آخر طلبات المستخدم: آخر طلب توصيل (WS) وآخر طلب حِرفة (HIRFA) وحالتهما الحالية. استخدمها دائماً عندما يسأل المستخدم عن حالة طلبه. يُمرر هاتف المرسل تلقائياً من النظام.',
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
        temperature: 0.4,
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
        const result = await executeTool(
          call.function?.name ?? '',
          args,
          phone
        );
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

async function runGroq(userText: string, phone: string): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[AI AGENT] Provider Groq skipped: GROQ_API_KEY is missing.');
    return null;
  }
  return runOpenAICompatible(
    'Groq',
    'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    // Verified against https://console.groq.com/docs/models: the Llama
    // Enterprise models (llama-3.3-70b-versatile etc.) now require "Contact
    // Sales" access — free/dev-plan keys get 404. The GPT-OSS models ARE
    // available on the developer plan and support tool use.
    process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    userText,
    phone
  );
}

// OpenRouter's free-tier catalog churns constantly (models get pulled
// every few weeks), so instead of chasing names we SELF-HEAL: when the
// configured model 404s ("No endpoints found"), we query OpenRouter's
// public catalog, pick the newest :free model that supports tools, and
// retry once. The pick is cached for subsequent calls.
let cachedOpenRouterModel: string | null = null;
const DEFAULT_OPENROUTER_MODEL = 'google/gemma-2-9b-it:free'; // first attempt

async function discoverOpenRouterFreeModel(): Promise<string | null> {
  if (cachedOpenRouterModel) return cachedOpenRouterModel;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        created?: number;
        supported_parameters?: string[];
      }>;
    };
    const candidates = (data.data ?? [])
      .filter(
        (m) =>
          typeof m.id === 'string' &&
          m.id.endsWith(':free') &&
          Array.isArray(m.supported_parameters) &&
          m.supported_parameters.includes('tools')
      )
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((m) => m.id as string);
    if (candidates.length === 0) return null;
    cachedOpenRouterModel = candidates[0];
    console.log(
      '[AI AGENT] OpenRouter discovered free tools-capable model:',
      cachedOpenRouterModel
    );
    return cachedOpenRouterModel;
  } catch (e) {
    console.error('[AI AGENT] OpenRouter model discovery failed:', e);
    return null;
  }
}

async function runOpenRouter(
  userText: string,
  phone: string
): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn(
      '[AI AGENT] Provider OpenRouter skipped: OPENROUTER_API_KEY is missing.'
    );
    return null;
  }

  const headers = {
    // OpenRouter recommends identifying the app (free tier courtesy rules).
    'X-Title': 'Wassilha',
  } as Record<string, string>;
  const configured = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

  try {
    // First attempt with the configured/default model…
    return await runOpenAICompatible(
      'OpenRouter',
      'https://openrouter.ai/api/v1/chat/completions',
      apiKey,
      configured,
      userText,
      phone,
      headers
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Self-heal ONLY on "model missing" 404s — every other error belongs
    // to the provider chain (auth, quota, outage…).
    if (!msg.includes('HTTP 404')) throw e;
    console.warn(
      '[AI AGENT] OpenRouter model missing:',
      configured,
      '— discovering a current free model…'
    );
  }

  const discovered = await discoverOpenRouterFreeModel();
  if (!discovered) {
    throw new Error('OpenRouter: no free tools-capable model found');
  }
  return runOpenAICompatible(
    'OpenRouter',
    'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    discovered,
    userText,
    phone,
    headers
  );
}

// --- Public entry point ------------------------------------------------------

// Gemini (the original SDK path). Throws so the chain can continue.
async function runGemini(userText: string, phone: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[AI AGENT] Provider Gemini skipped: GEMINI_API_KEY is missing.');
    return null;
  }

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
        (call.args ?? {}) as Record<string, unknown>,
        phone
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
    run: (t: string, p: string) => Promise<string | null>;
  }> = [
    { name: 'Groq', run: runGroq },
    { name: 'OpenRouter', run: runOpenRouter },
    { name: 'Gemini', run: runGemini },
  ];

  for (const provider of chain) {
    console.log('[AI AGENT] Trying provider:', provider.name);
    try {
      const reply = await provider.run(text, phone);
      // null = provider skipped (API key missing) — already logged with a
      // console.warn by the provider itself. Fall through to the next one.
      if (reply !== null) return reply;
    } catch (e) {
      console.error(`[AI AGENT] Provider ${provider.name} failed:`, e);
    }
  }

  console.error(
    '[AI AGENT] API Keys status -> Groq:',
    !!process.env.GROQ_API_KEY,
    '| OpenRouter:',
    !!process.env.OPENROUTER_API_KEY,
    '| Gemini:',
    !!process.env.GEMINI_API_KEY
  );
  console.error('[AI AGENT] All providers failed — returning busy message.');
  return BUSY_MESSAGE;
}