// WASSILHA AI AGENT — the "brain" behind the WhatsApp assistant.
//
// Architecture:
//   WhatsApp Cloud API (Meta) -> /api/whatsapp/webhook -> aiAgentReply()
//   -> Gemini (gemini-1.5-flash, free tier) with Function Calling
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

const MODEL_NAME = 'gemini-1.5-flash';
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

// --- Public entry point ------------------------------------------------------

/**
 * Takes an inbound WhatsApp message (already normalized phone + raw text)
 * and returns the final assistant reply. Runs the Gemini function-calling
 * loop until the model produces a text answer (bounded by MAX_TOOL_ROUNDS).
 */
export async function aiAgentReply(
  userText: string,
  phone: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const text = userText.trim();
  if (!apiKey) {
    console.error('[AI AGENT] GEMINI_API_KEY missing — replying with static help.');
    return FALLBACK_REPLY;
  }
  if (!text) return FALLBACK_REPLY;

  console.log('[AI AGENT] Sending to Gemini:', text);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: toolDeclarations }],
    });

    const chat = model.startChat();
    let result = await chat.sendMessage(
      `${text}\n\n(رقم هاتف المرسل: ${phone} — مرره كما هو إذا استدعيت getOrderStatus)`
    );

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) {
        const reply = result.response.text();
        console.log('[AI AGENT] Gemini response:', reply);
        return reply && reply.trim() ? reply.trim() : FALLBACK_REPLY;
      }

      // Execute every tool call the model asked for, then hand the results
      // back so Gemini can compose the final answer.
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

    // Model kept calling tools past the cap — take whatever text it has.
    const last = result.response.text();
    return last && last.trim() ? last.trim() : FALLBACK_REPLY;
  } catch (e) {
    console.error('[AI AGENT] Gemini Error:', e);
    return FALLBACK_REPLY;
  }
}