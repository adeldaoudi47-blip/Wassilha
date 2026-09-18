// HIRFA Phase 1 — stable, URL-safe slug utilities.
//
// Slugs are generated ONCE (when an artisan applies or during the one-off
// backfill) and are NEVER regenerated from displayName/nameAr changes, so a
// public store/product URL stays stable for life. Pure (no DB) so the same
// logic runs server-side (apply route, public pages) and in the backfill script.
const ARABIC_TO_LATIN: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 's', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'd', ر: 'r', ز: 'ز', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: '3', غ: 'g',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  و: 'w', ه: 'h', ي: 'y', ة: 't', ى: 'y',
  إ: 'a', أ: 'a', آ: 'a', ؤ: 'w', ئ: 'y', ء: '',
};
// Strip Arabic Harakat / Tatweel / Kashida so slugs stay stable & ASCII.
const HARAKAT = /[\u064B-\u065F\u0670\u0640]/g;

export function slugify(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(HARAKAT, '');
  let latin = '';
  for (const ch of cleaned) {
    if (ARABIC_TO_LATIN[ch] !== undefined) latin += ARABIC_TO_LATIN[ch];
    else if (/[a-z0-9]/i.test(ch)) latin += ch;
    else latin += ' ';
  }
  const slug = latin
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length >= 2 ? slug : null;
}

/** Stable base slug for a store (falls back to store-<idprefix>). */
export function artisanSlugBase(displayName: string | null, idPrefix: string): string {
  return slugify(displayName) ?? `store-${idPrefix}`;
}
/** Stable base slug for a product (falls back to product-<idprefix>). */
export function productSlugBase(name: string | null, idPrefix: string): string {
  return slugify(name) ?? `product-${idPrefix}`;
}
