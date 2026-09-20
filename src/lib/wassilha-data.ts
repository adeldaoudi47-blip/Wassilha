import type { CargoKey } from './types';

// El Guerrara (القرارة), Ghardaïa — VERIFIED town centroid.
// Source: OpenStreetMap relation 4874055 ("القرارة / El Guerrara", town,
// place_rank 16, importance 0.34), confirmed three ways: forward search in
// French and Arabic, and reverse geocode of the point itself (→
// "RN 124, 11 décembre, القرارة, دائرة القرارة, غرداية").
// The PREVIOUS value { lat: 32.7833, lng: 3.7667 } was wrong: reverse
// geocoding it returns بريان (Berriane), a different town ~64 km WEST of
// El Guerrara. The latitude was only ~0.5 km off, but the longitude was
// off by ~0.72°. That meant every free-text address fallback, the demo
// seed coordinates, and the map's default centre all pointed at Berriane.
export const GUERRARA_CENTER = { lat: 32.7885786, lng: 4.4882869 };

export const GUERRARA_LOCATIONS = [
  'حي 05 جويلية - القرارة',
  'وسط المدينة - القرارة',
  'حي المستقبل - القرارة',
  'طريق غرداية - القرارة',
  'سوق القرارة المركزي',
  'حي النصر - القرارة',
  'المنطقة الصناعية - القرارة',
  'حي الواحة - القرارة',
];

// Approximate coords for each location (for the stylized map). These keep
// their original stylized SPREAD but have been re-anchored on the verified
// GUERRARA_CENTER above — previously they clustered ~64 km too far west,
// around Berriane, so picking any of them panned the map to the wrong town.
export const GUERRARA_COORDS: Record<number, { lat: number; lng: number }> = {
  0: { lat: 32.7943, lng: 4.4796 },
  1: { lat: 32.7886, lng: 4.4883 },
  2: { lat: 32.7833, lng: 4.4936 },
  3: { lat: 32.7763, lng: 4.4876 },
  4: { lat: 32.7913, lng: 4.4996 },
  5: { lat: 32.7793, lng: 4.4766 },
  6: { lat: 32.7733, lng: 4.5016 },
  7: { lat: 32.7973, lng: 4.4916 },
};

export interface CargoMeta {
  key: CargoKey;
  icon: string;
  color: string;
}

export const CARGO_TYPES: CargoMeta[] = [
  { key: 'parcel', icon: 'Package', color: '#0EA5E9' },
  { key: 'goods', icon: 'Layers', color: '#8B5CF6' },
  { key: 'shop', icon: 'Store', color: '#F59E0B' },
  { key: 'furniture', icon: 'Sofa', color: '#EF4444' },
  { key: 'appliance', icon: 'Refrigerator', color: '#10B981' },
  { key: 'construction', icon: 'HardHat', color: '#6B7280' },
  { key: 'personal', icon: 'Briefcase', color: '#EC4899' },
  { key: 'other', icon: 'EllipsisHorizontalCircle', color: '#64748B' },
  // Passenger transport. Yellow (Yassir-like) + a `Car` icon so the
  // driver / admin / customer see a clear visual distinction from
  // cargo. Multiplier of 1.5 reflects that a taxi seats passengers
  // (not bulk weight) but still costs more than a base parcel due to
  // detour / waiting time.
  { key: 'taxi', icon: 'Car', color: '#FACC15' },
];

export const CARGO_MULTIPLIERS_DEFAULT: Record<CargoKey, number> = {
  parcel: 1.0,
  goods: 1.1,
  shop: 1.0,
  furniture: 1.5,
  appliance: 1.4,
  construction: 1.8,
  personal: 1.0,
  other: 1.0,
  // Taxi multiplier (1.5) — higher than `parcel` to reflect the
  // passenger-service premium, but lower than `furniture` /
  // `construction` since the driver isn't carrying bulky cargo.
  taxi: 1.5,
  // Craft multiplier (1.0) — same as parcel since handmade items
  // are typically small and light.
  craft: 1.0,
};

// Haversine distance in km
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round((2 * R * Math.asin(Math.sqrt(h))) * 10) / 10;
}

export function calcPrice(
  base: number,
  perKm: number,
  distance: number,
  multiplier: number
): number {
  return Math.round((base + distance * perKm) * multiplier);
}

// Human-friendly, unambiguous alphabet: no 0/O and no 1/I, so codes stay
// legible when a customer reads one out over the phone.
const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCodeBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  // Web Crypto is available in Node 19+ and in every modern browser over
  // https/localhost. We deliberately do NOT `import` node:crypto: this
  // module is also bundled into client components, and a Node builtin
  // import would break the browser build. The Math.random fallback only
  // covers ancient runtimes; uniqueness, not secrecy, is the goal here.
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

/**
 * Collision-resistant human-readable order code: `WS-XXXXXX`.
 *
 * The previous version drew a 5-digit decimal number — only 100 000
 * possible codes. `Order.code` is `@unique`, so by the birthday paradox a
 * 50% collision chance was reached at roughly 12 000 orders, and every
 * collision threw Prisma `P2002` and 500-ed the whole order creation.
 *
 * This draws 8 symbols from a 32-symbol alphabet → 2^40 (~1.1 trillion)
 * codes. `256 % 32 === 0`, so the modulo below introduces no bias. The
 * 50% collision point is now ~1.2 million orders, and callers still retry
 * on `P2002` (see `src/app/api/orders/route.ts`) as defence in depth.
 */
export function generateOrderCode(): string {
  const bytes = randomCodeBytes(8);
  let body = '';
  for (let i = 0; i < 8; i++) {
    body += ORDER_CODE_ALPHABET[bytes[i] % 32];
  }
  return `WS-${body}`;
}

export function formatDzd(n: number): string {
  return n.toLocaleString('fr-DZ');
}
