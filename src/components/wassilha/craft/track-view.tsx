'use client';

// HIRFA Phase 2A — invisible page-view tracker for the public marketplace.
//
// Why client-side and not in the server component? The pages are ISR-cached
// (revalidate = 60s), so a server-side insert would fire once per cache
// regeneration, not once per real visit. Firing from the browser counts actual
// human/browser views (bots that run JS are counted too — acceptable noise).
//
// Uses fetch + keepalive so the beacon survives the page being closed, and
// retries never block navigation. Fires ONCE per mount per (target).
import { useEffect } from 'react';
import type { CraftEventType } from '@/lib/analytics';

interface TrackViewProps {
  storeId: string;
  productId?: string;
  type?: Extract<CraftEventType, 'store_view' | 'product_view'>;
}

export function TrackView({ storeId, productId, type }: TrackViewProps) {
  const eventType = type ?? (productId ? 'product_view' : 'store_view');

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        await fetch('/api/craft/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: eventType, storeId, productId: productId ?? undefined }),
          keepalive: true,
          signal: controller.signal,
          // No credentials: this event is anonymous on purpose.
          credentials: 'omit',
        });
      } catch {
        // Swallow: tracking must never disturb the visitor.
      }
    };
    run();
    return () => controller.abort();
  }, [storeId, productId, eventType]);

  return null;
}
