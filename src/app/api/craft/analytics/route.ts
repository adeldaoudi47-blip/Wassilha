// HIRFA Phase 2A — anonymous analytics ingest.
// POST /api/craft/analytics  { storeId?, productId?, type }
//
// Public (no auth): a page view or a share click must be trackable for guests.
// Only the 4 whitelisted event types are accepted, and only ids we can resolve
// to an ACTIVE store / its ACTIVE product are stored — never a made-up id.
//
// PII-free by construction: no user id, phone, IP, cookie or query text is read
// or persisted. A light per-IP fixed-window guard keeps the endpoint from being
// used as a write-amplification vector; it fails OPEN (analytics is best-effort).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isCraftEventType } from '@/lib/analytics';
import { rateLimit, clientIp } from '@/lib/rate-limit';

const RATE_LIMIT_MAX = 60; // events / 10 min / source
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'badRequest' }, { status: 400 });
    }
    const { type, storeId, productId } = (body || {}) as {
      type?: string;
      storeId?: string;
      productId?: string;
    };

    if (!isCraftEventType(type)) {
      return NextResponse.json({ error: 'invalidEventType' }, { status: 400 });
    }

    // Resolve the store: must exist and be ACTIVE (pending stores get no stats).
    if (!storeId || typeof storeId !== 'string') {
      return NextResponse.json({ error: 'storeIdRequired' }, { status: 400 });
    }
    const store = await db.artisanProfile.findUnique({
      where: { id: storeId },
      select: { id: true, status: true },
    });
    if (!store || store.status !== 'active') {
      // Silently accept: the visitor saw something, but we track nothing for a
      // store that is not public. 200 so the client never retries in a loop.
      return NextResponse.json({ ok: true, tracked: false });
    }

    // If a product is claimed, it must belong to that store and be active.
    let resolvedProductId: string | null = null;
    if (productId && typeof productId === 'string') {
      const product = await db.craftProduct.findUnique({
        where: { id: productId },
        select: { id: true, isActive: true, artisanId: true },
      });
      if (product && product.isActive && product.artisanId === store.id) {
        resolvedProductId = product.id;
      }
    }

    // Product-scoped events must actually carry a valid product.
    if ((type === 'product_view') && !resolvedProductId) {
      return NextResponse.json({ ok: true, tracked: false });
    }

    const ip = clientIp(req);
    const rl = await rateLimit(`crafta:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      return NextResponse.json({ ok: true, tracked: false, throttled: true });
    }

    await db.craftAnalyticsEvent.create({
      data: {
        artisanId: store.id,
        productId: resolvedProductId,
        eventType: type,
      },
    });

    return NextResponse.json({ ok: true, tracked: true });
  } catch (e) {
    console.error('[api/craft/analytics]', e);
    // Never fail the visitor's page because tracking broke.
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
