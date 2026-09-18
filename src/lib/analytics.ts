// HIRFA Phase 2A — anonymous marketplace analytics.
//
// Privacy posture: events carry ONLY { artisanId?, productId?, eventType,
// createdAt }. No user id, no phone, no IP, no cookie / fingerprint, no search
// query text. This is intentional: we count interactions, not people.
//
// `trackCraftEvent` is fire-and-forget and never throws — analytics must never
// break a page render or a share action.

export const CRAFT_EVENT_TYPES = [
  'store_view',
  'product_view',
  'share',
  'copy_link',
] as const;

export type CraftEventType = (typeof CRAFT_EVENT_TYPES)[number];

export function isCraftEventType(v: unknown): v is CraftEventType {
  return typeof v === 'string' && (CRAFT_EVENT_TYPES as readonly string[]).includes(v);
}

export interface CraftEventInput {
  artisanId?: string | null;
  productId?: string | null;
  eventType: CraftEventType;
}

/**
 * Persist one anonymous analytics event. Errors are swallowed on purpose
 * (best-effort tracking): a DB hiccup must never 500 a public page.
 */
export async function trackCraftEvent(input: CraftEventInput): Promise<void> {
  if (!input.artisanId && !input.productId) return;
  try {
    // Imported lazily so a bare import of this helper from a client-adjacent
    // module never eagerly instantiates a Prisma client.
    const { db } = await import('./db');
    await db.craftAnalyticsEvent.create({
      data: {
        artisanId: input.artisanId ?? null,
        productId: input.productId ?? null,
        eventType: input.eventType,
      },
    });
  } catch (e) {
    console.warn('[craft-analytics] failed to track event', input.eventType, e);
  }
}
