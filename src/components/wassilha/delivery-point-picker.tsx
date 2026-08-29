'use client';

import { useMemo, useState } from 'react';

export type DeliveryAreaOption = {
  id: string;
  nameAr: string;
  nameFr?: string | null;
};

export type DeliveryPointOption = {
  id: string;
  nameAr: string;
  nameFr?: string | null;
  type: string;
  areaId: string;
};

export type DeliveryCoords = { lat: number; lng: number };

export type DeliveryPointPickerProps = {
  areas: ReadonlyArray<DeliveryAreaOption>;
  points: ReadonlyArray<DeliveryPointOption>;
  /**
   * Coords to return when a point has no verified lat/lng. In production
   * this should be the city center (El Guerrara: 32.7833, 3.7667) or the
   * parent area's approximate centroid. We never fabricate coords.
   */
  fallbackCoords: DeliveryCoords;
  /**
   * Optional per-slug override for known area centers. When a point inside
   * `slug` is selected we use `coordsForArea[slug]` instead of
   * `fallbackCoords`. Pass an empty object to always fall back to the city
   * center.
   */
  coordsForArea?: Readonly<Record<string, DeliveryCoords>>;
  onSelect: (point: DeliveryPointOption, coords: DeliveryCoords) => void;
  /**
   * Whether to render the chrome in RTL. The app is Arabic-first so this
   * defaults to true.
   */
  isRtl?: boolean;
  /**
   * Search-bar placeholder overrides. Both languages default to neutral
   * but locale-friendly copy.
   */
  placeholderArea?: string;
  placeholderPoint?: string;
};

/**
 * DeliveryPointPicker
 * --------------------
 * Two-step picker used by the customer flow to pick a pickup / dropoff
 * point in El Guerrara:
 *   1. user picks a neighbourhood (حي) from the 41 areas;
 *   2. user picks a specific landmark (مسجد، مدرسة، صيدلية، ...) within
 *      that neighbourhood.
 *
 * The component is fully controlled by the parent: the parent supplies
 * `areas`, `points` and `coordsForArea`, and the parent receives the
 * selected point + resolved coords via `onSelect`. The component does NOT
 * fetch anything; if the host wants the data to come from the server it
 * can pass the Prisma-fetched list as `points` (mapped to the same shape).
 */
export function DeliveryPointPicker({
  areas,
  points,
  fallbackCoords,
  coordsForArea,
  onSelect,
  isRtl = true,
  placeholderArea = '🔎 ابحث عن حي...',
  placeholderPoint = '🔎 ابحث عن مسجد، مدرسة، صيدلية...',
}: DeliveryPointPickerProps) {
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | null>(null);

  const filteredAreas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter(
      (a) =>
        a.nameAr.toLowerCase().includes(q) ||
        a.nameFr?.toLowerCase().includes(q),
    );
  }, [areas, search]);

  const filteredPoints = useMemo(() => {
    if (!selectedArea) return [];
    const q = search.trim().toLowerCase();
    return points.filter((p) => {
      if (p.areaId !== selectedArea) return false;
      if (!q) return true;
      return (
        p.nameAr.toLowerCase().includes(q) ||
        p.nameFr?.toLowerCase().includes(q)
      );
    });
  }, [points, selectedArea, search]);

  if (!selectedArea) {
    return (
      <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">📍 اختر نقطة التسليم</h2>
          <p className="text-sm text-muted-foreground">
            اختر الحي أولاً ثم نقطة التسليم
          </p>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholderArea}
          className="w-full rounded-xl border p-3"
        />

        <div className="grid gap-2">
          {filteredAreas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                setSelectedArea(area.id);
                setSearch('');
              }}
              className="rounded-xl border p-4 text-right hover:bg-muted"
            >
              <div className="font-semibold">📍 {area.nameAr}</div>
              {area.nameFr && (
                <div className="text-sm text-muted-foreground" dir="ltr">
                  {area.nameFr}
                </div>
              )}
            </button>
          ))}

          {filteredAreas.length === 0 && (
            <div className="rounded-xl border p-5 text-center text-muted-foreground">
              لا توجد منطقة مطابقة.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-4">
      <button
        type="button"
        onClick={() => {
          setSelectedArea(null);
          setSearch('');
        }}
        className="text-sm"
      >
        ← العودة إلى الأحياء
      </button>

      <h2 className="text-xl font-bold">📍 نقاط التسليم</h2>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholderPoint}
        className="w-full rounded-xl border p-3"
      />

      <div className="space-y-2">
        {filteredPoints.map((point) => (
          <button
            key={point.id}
            type="button"
            onClick={() => {
              const resolved = coordsForArea?.[point.areaId] ?? fallbackCoords;
              onSelect(point, resolved);
            }}
            className="w-full rounded-xl border p-4 text-right hover:bg-muted"
          >
            <div className="font-semibold">📍 {point.nameAr}</div>
            {point.nameFr && (
              <div className="text-sm text-muted-foreground" dir="ltr">
                {point.nameFr}
              </div>
            )}
          </button>
        ))}

        {filteredPoints.length === 0 && (
          <div className="rounded-xl border p-5 text-center text-muted-foreground">
            لا توجد نقطة مطابقة حالياً.
          </div>
        )}
      </div>
    </div>
  );
}

export default DeliveryPointPicker;