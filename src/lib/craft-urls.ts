import { absoluteUrl } from './site';

// Stable public URLs. The store/product slug is the canonical public key;
// the DB id is only a fallback for un-slugged rows during the backfill window.
export function getStoreUrl(slug: string | null, id: string): string {
  const s = slug && slug.length >= 2 ? slug : `store-${id.slice(0, 8)}`;
  return `/craft/${encodeURIComponent(s)}`;
}
// `storeId` is the owning STORE id and drives the store-segment fallback.
// (Previously this fell back to the product id, which produced a store segment
// that matched no artisan → 404. It is optional only to keep old call sites
// compiling; pass it wherever the store id is known.)
export function getProductUrl(
  storeSlug: string | null,
  productSlug: string | null,
  productId: string,
  storeId?: string
): string {
  const s = storeSlug && storeSlug.length >= 2 ? storeSlug : `store-${(storeId ?? productId).slice(0, 8)}`;
  const p = productSlug && productSlug.length >= 2 ? productSlug : `product-${productId.slice(0, 8)}`;
  return `/craft/${encodeURIComponent(s)}/product/${encodeURIComponent(p)}`;
}
export function getStoreAbsoluteUrl(slug: string | null, id: string): string {
  return absoluteUrl(getStoreUrl(slug, id));
}
export function getProductAbsoluteUrl(
  storeSlug: string | null,
  productSlug: string | null,
  productId: string,
  storeId?: string
): string {
  return absoluteUrl(getProductUrl(storeSlug, productSlug, productId, storeId));
}
