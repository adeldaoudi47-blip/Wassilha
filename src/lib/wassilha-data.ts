import type { CargoKey } from './types';

// El Guerrara, Ghardaïa locations (lat/lng centered on 32.7833, 3.7667)
export const GUERRARA_CENTER = { lat: 32.7833, lng: 3.7667 };

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

// Approximate coords for each location (for the stylized map)
export const GUERRARA_COORDS: Record<number, { lat: number; lng: number }> = {
  0: { lat: 32.789, lng: 3.758 },
  1: { lat: 32.7833, lng: 3.7667 },
  2: { lat: 32.778, lng: 3.772 },
  3: { lat: 32.771, lng: 3.766 },
  4: { lat: 32.786, lng: 3.778 },
  5: { lat: 32.774, lng: 3.755 },
  6: { lat: 32.768, lng: 3.78 },
  7: { lat: 32.792, lng: 3.77 },
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

export function generateOrderCode(): string {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `WS-${n}`;
}

export function formatDzd(n: number): string {
  return n.toLocaleString('fr-DZ');
}
