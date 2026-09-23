// HIRFA Phase 3 — shared server-side pricing helpers for the craft
// marketplace (Alibaba-style variants / tiers / coupons).
//
// SECURITY: every price/discount in this module is computed from values the
// SERVER loaded from the DB. Client-submitted prices are never trusted; the
// cart payload only carries ids + quantities (+ a variant id + a coupon
// code), and the final numbers are always recomputed here.

export interface TierRow {
  minQuantity: number;
  unitPrice: number;
}

export interface VariantRow {
  id: string;
  priceAdjustment: number;
  stock: number;
}

/**
 * The graduated-price tier that applies to an order of `qty` units:
 * the tier with the HIGHEST `minQuantity` that `qty` still satisfies.
 * Returns null when the quantity qualifies for no tier (i.e. it is below
 * the smallest `minQuantity`), in which case the base price is used.
 */
export function pickTier(tiers: TierRow[], qty: number): TierRow | null {
  let best: TierRow | null = null;
  for (const t of tiers) {
    if (qty >= t.minQuantity && (!best || t.minQuantity > best.minQuantity)) best = t;
  }
  return best;
}

/**
 * The unit price for one line of `qty` units of a product priced `price`,
 * optionally with a variant whose `priceAdjustment` is added on top.
 *
 * Rule (documented in the UI): a qualifying tier REPLACES the unit price
 * entirely — but the variant adjustment is still honoured when the tier was
 * authored against the plain product price. If no tier qualifies, the unit
 * price is `price + adjustment`.
 */
export function unitPriceFor(
  price: number,
  adjustment: number,
  qty: number,
  tiers: TierRow[],
): number {
  const base = price + adjustment;
  const tier = pickTier(tiers, qty);
  if (tier) return tier.unitPrice + adjustment;
  return base;
}

/**
 * Coupon discount over a subtotal. `type` is the free String column on
 * Coupon; only "percent" and "fixed" are written today, anything else is
 * rejected by the caller before reaching this function.
 *
 * The returned amount is ALWAYS clamped to [0, subtotal] so a mis-sized
 * coupon can never produce a negative order total.
 */
export function couponDiscount(
  type: string,
  value: number,
  subtotal: number,
): number {
  if (subtotal <= 0) return 0;
  if (type === 'percent') {
    const pct = Math.min(100, Math.max(0, value));
    return Math.round((subtotal * pct) / 100);
  }
  if (type === 'fixed') {
    return Math.min(subtotal, Math.max(0, value));
  }
  return 0;
}

/**
 * The "ابتداءً من / à partir de" price shown on tiles: the lowest unit price
 * a buyer can reach on this product — across tiers and variants.
 *
 * Returns 0 when the product has NO variants and NO tiers, which the UI
 * reads as "no graduated pricing — just show `price`".
 */
export function computeBasePrice(
  price: number,
  variants: { priceAdjustment: number }[],
  tiers: TierRow[],
): number {
  const candidates: number[] = [];
  if (tiers.length) {
    // tiers are sorted by minQuantity ascending by the caller; the last one
    // is the deepest discount.
    candidates.push(tiers[tiers.length - 1].unitPrice);
  }
  for (const v of variants) candidates.push(price + v.priceAdjustment);
  if (!candidates.length) return 0;
  const min = Math.min(...candidates);
  return Number.isFinite(min) && min >= 0 ? min : 0;
}
