// Server-side pricing. The client-supplied `price` is NEVER trusted.
// SECURITY (V7): the fare is always recomputed here from the active
// `Pricing` row (multipliers per cargo type) and a Haversine distance
// derived from the pickup/dropoff coordinates. If the `Pricing` table
// is empty or unreachable, we fall back to the same defaults the
// client uses so the order is never rejected because the admin has
// not yet configured pricing.
import { db } from './db';
import {
  CARGO_MULTIPLIERS_DEFAULT,
  calcPrice,
  haversineKm,
} from './wassilha-data';
import type { CargoKey } from './types';

const DEFAULT_BASE_PRICE = 200; // DZD
const DEFAULT_PER_KM = 50; // DZD / km

// Shape of the `Pricing` table JSON `multipliers` column. We keep the
// shape lenient (numbers per cargo key) so the admin can add new cargo
// types without redeploying the API.
export type PricingMultipliers = Partial<Record<CargoKey, number>>;

interface ActivePricingRow {
  basePrice: number;
  perKm: number;
  multipliers: string; // JSON column
}

export async function loadActivePricing(): Promise<{
  basePrice: number;
  perKm: number;
  multipliers: PricingMultipliers;
}> {
  try {
    // The active Pricing row is a single record (id = 'default'). If
    // it does not exist (admin has not configured pricing) we fall
    // back to the client-side defaults so order creation still works.
    const row = (await (db as any).pricing.findUnique({
      where: { id: 'default' },
    })) as ActivePricingRow | null;
    if (!row) {
      return {
        basePrice: DEFAULT_BASE_PRICE,
        perKm: DEFAULT_PER_KM,
        multipliers: { ...CARGO_MULTIPLIERS_DEFAULT },
      };
    }
    let parsed: PricingMultipliers = {};
    try {
      parsed = JSON.parse(row.multipliers) as PricingMultipliers;
    } catch {
      parsed = {};
    }
    // Backfill any missing cargo keys with the default multiplier so
    // a new cargo type never silently prices at 1.0.
    for (const k of Object.keys(CARGO_MULTIPLIERS_DEFAULT) as CargoKey[]) {
      if (typeof parsed[k] !== 'number' || parsed[k]! <= 0) {
        parsed[k] = CARGO_MULTIPLIERS_DEFAULT[k];
      }
    }
    return {
      basePrice: row.basePrice ?? DEFAULT_BASE_PRICE,
      perKm: row.perKm ?? DEFAULT_PER_KM,
      multipliers: parsed,
    };
  } catch {
    return {
      basePrice: DEFAULT_BASE_PRICE,
      perKm: DEFAULT_PER_KM,
      multipliers: { ...CARGO_MULTIPLIERS_DEFAULT },
    };
  }
}

// Compute the server-authoritative price. Caller MUST pass numbers in
// the valid lat/lng ranges; the function does not sanity-check
// coordinates (the POST handler validates `typeof === 'number'`).
export async function computeOrderPrice(opts: {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  cargoType: CargoKey;
}): Promise<{ price: number; distanceKm: number }> {
  const pricing = await loadActivePricing();
  const distanceKm = haversineKm(
    { lat: opts.pickupLat, lng: opts.pickupLng },
    { lat: opts.dropoffLat, lng: opts.dropoffLng }
  );
  const mult = pricing.multipliers[opts.cargoType] ?? 1;
  const price = calcPrice(
    pricing.basePrice,
    pricing.perKm,
    distanceKm,
    mult
  );
  return { price, distanceKm };
}