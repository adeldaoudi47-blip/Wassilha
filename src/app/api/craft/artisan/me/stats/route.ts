import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

// GET /api/craft/artisan/me/stats
// Artisan-only: REAL aggregate counts for the seller's own store, straight
// from CraftAnalyticsEvent. No sampling, no fakes: a fresh store sees 0.
//
// Returned shape (all integers, all-time):
//   { storeViews, productViews, shares, copies, productViewsBreakdown?: [...] }
export async function GET() {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const [storeViews, productViews, shares, copies] = await Promise.all([
      db.craftAnalyticsEvent.count({ where: { artisanId: gate.artisanId, eventType: 'store_view' } }),
      db.craftAnalyticsEvent.count({
        where: {
          artisanId: gate.artisanId,
          eventType: 'product_view',
          // Only count views of products that still exist.
          product: { isActive: true },
        },
      }),
      db.craftAnalyticsEvent.count({ where: { artisanId: gate.artisanId, eventType: 'share' } }),
      db.craftAnalyticsEvent.count({ where: { artisanId: gate.artisanId, eventType: 'copy_link' } }),
    ]);

    return NextResponse.json({ storeViews, productViews, shares, copies });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
