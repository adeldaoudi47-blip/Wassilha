'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLng } from 'leaflet';
import L from 'leaflet';
import { Crosshair, MapPin, Navigation, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GUERRARA_CENTER, GUERRARA_COORDS, GUERRARA_LOCATIONS } from '@/lib/wassilha-data';

export interface InteractiveMapProps {
  /**
   * Initial map center. Defaults to the city center of El Guerrara.
   */
  defaultCenter?: { lat: number; lng: number };
  /**
   * Initial map zoom (1-19). Defaults to 14 which gives a good city-level view.
   */
  defaultZoom?: number;
  /**
   * Pickup coords (optional). When set, a red target marker is rendered.
   */
  pickupCoords?: { lat: number; lng: number } | null;
  /**
   * Dropoff coords (optional). When set, an orange marker is rendered.
   */
  dropoffCoords?: { lat: number; lng: number } | null;
  pickupLabel?: string;
  dropoffLabel?: string;
  /**
   * Height class (Tailwind). Defaults to `h-52` to match the existing preview.
   */
  height?: string;
  className?: string;
  /**
   * Search-bar placeholder. Defaults to the city name.
   */
  searchPlaceholder?: string;
  /**
   * Optional callback fired when a search result is selected.
   */
  onSelectPlace?: (place: { label: string; lat: number; lng: number }) => void;
}

// Reuse the same pin icons we already ship with `live-map.tsx` so the visual
// language is consistent across the app. The factories are defined at module
// scope but the actual `L.Icon`/`L.divIcon` instances are created lazily on
// the client (see `useLeafletIcons` below) — that way Leaflet never touches
// `window` during server-side prerendering.

const PICKUP_TARGET_HTML =
  '<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));">' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#DC2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10"></circle>' +
  '<circle cx="12" cy="12" r="6"></circle>' +
  '<circle cx="12" cy="12" r="2" fill="#DC2626"></circle>' +
  '<line x1="12" y1="2" x2="12" y2="5"></line>' +
  '<line x1="12" y1="19" x2="12" y2="22"></line>' +
  '<line x1="2" y1="12" x2="5" y2="12"></line>' +
  '<line x1="19" y1="12" x2="22" y2="12"></line>' +
  '</svg>' +
  '</div>';

const USER_LOCATION_HTML =
  '<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(14,107,94,0.55));">' +
  '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(14,107,94,0.18);animation:wassilha-gps-pulse 1.6s ease-out infinite;"></div>' +
  '<div style="position:relative;width:14px;height:14px;border-radius:50%;background:#0E6B5E;border:2.5px solid #fff;box-sizing:border-box;"></div>' +
  '</div>';

// Slightly larger variant of the user dot so it's easy to see when the user
// has set their location by tapping the map (no GPS halo to avoid confusion
// with the live GPS marker).
const MANUAL_LOCATION_HTML =
  '<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(14,107,94,0.55));">' +
  '<div style="position:relative;width:18px;height:18px;border-radius:50%;background:#0E6B5E;border:3px solid #fff;box-sizing:border-box;"></div>' +
  '</div>';

function useLeafletIcons() {
  // Lazily construct icons on the client. `useState` initialiser runs only
  // on the client (because the component is hydrated after the static HTML
  // is rendered), so Leaflet never sees a `window` reference server-side.
  const [icons, setIcons] = useState<{
    dropoff: L.Icon;
    pickup: L.DivIcon;
    user: L.DivIcon;
    manual: L.DivIcon;
  } | null>(null);

  useEffect(() => {
    if (icons) return;
    setIcons({
      dropoff: new L.Icon({
        iconUrl:
          'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
      pickup: L.divIcon({
        className: 'wassilha-pickup-target',
        html: PICKUP_TARGET_HTML,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
      }),
      user: L.divIcon({
        className: 'wassilha-user-location',
        html: USER_LOCATION_HTML,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      manual: L.divIcon({
        className: 'wassilha-manual-location',
        html: MANUAL_LOCATION_HTML,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    });
  }, [icons]);

  return icons;
}

/**
 * Internal helper that calls imperative Leaflet APIs from inside a child of
 * <MapContainer />. The latest "fly-to" coords and the user's GPS coords are
 * passed in via refs so the effect re-runs whenever they change.
 */
function MapController({
  flyTo,
  userLocation,
  manualLocation,
  pickup,
  dropoff,
}: {
  flyTo: { lat: number; lng: number; zoom?: number } | null;
  userLocation: { lat: number; lng: number } | null;
  manualLocation: { lat: number; lng: number } | null;
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  // Fly to search result.
  useEffect(() => {
    if (!flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, {
      duration: 0.8,
      easeLinearity: 0.25,
    });
  }, [flyTo, map]);
  // Fly to the user's location the first time we get *any* fix. Priority is
  // live GPS (`userLocation`) over manual pick (`manualLocation`) so a fresh
  // GPS update always wins over a stale tap. We use a single ref that stores
  // the last lat/lng we flew to regardless of which source produced it.
  const lastFlownLoc = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const target = userLocation ?? manualLocation;
    if (!target) return;
    if (lastFlownLoc.current) {
      const last = lastFlownLoc.current;
      if (Math.abs(last.lat - target.lat) < 1e-5 && Math.abs(last.lng - target.lng) < 1e-5) {
        return; // Already centred on this exact point
      }
    }
    lastFlownLoc.current = target;
    map.flyTo([target.lat, target.lng], 15, {
      duration: 0.8,
      easeLinearity: 0.25,
    });
  }, [userLocation, manualLocation, map]);
  // Fit bounds when pickup/dropoff both change.
  const lastFitKey = useRef<string>('');
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const key = `${pickup.lat.toFixed(5)},${pickup.lng.toFixed(5)}|${dropoff.lat.toFixed(5)},${dropoff.lng.toFixed(5)}`;
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    const bounds = L.latLngBounds([
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng],
    ]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  }, [pickup, dropoff, map]);
  return null;
}

/**
 * Internal helper that captures clicks anywhere on the map and forwards the
 * LatLng up to the parent via the supplied callback. Used to let the user
 * pick their location manually as a fallback when GPS permission is denied.
 */
function MapClickHandler({ onClick }: { onClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng);
    },
  });
  return null;
}

/**
 * InteractiveMap
 * ---------------
 * Real interactive Leaflet map that replaces the static SVG schematic on
 * the customer home page. The user can:
 *   - search any of the known El Guerrara neighborhoods (offline) and tap
 *     a result to fly the camera to that point;
 *   - tap the GPS button in the top-left to centre the map on their device
 *     location (via the browser Geolocation API);
 *   - see the pickup (red target) and dropoff (orange pin) markers that the
 *     parent already maintains in its state.
 *
 * The map renders OpenStreetMap tiles via the same CDN as `live-map.tsx`.
 */
export function InteractiveMap({
  defaultCenter = GUERRARA_CENTER,
  defaultZoom = 14,
  pickupCoords = null,
  dropoffCoords = null,
  pickupLabel,
  dropoffLabel,
  height = 'h-52',
  className,
  searchPlaceholder = 'القرارة، غرداية',
  onSelectPlace,
}: InteractiveMapProps) {
  const [search, setSearch] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  );
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  // When the user explicitly denies/can't grant location, we offer a manual
  // fallback: tapping the map sets this. Display order is `userLocation` →
  // `manualLocation` (a live GPS fix always wins over a stale manual pick).
  const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  // Lightweight success toast when the user picks a location by tapping the
  // map. Lives in a separate slot from `locateError` so the two colours
  // (rose vs. teal) don't fight each other.
  const [manualToast, setManualToast] = useState<string | null>(null);
  // When the user has successfully set *some* location (GPS or manual) we
  // stop nagging them with the permission prompt. Resetting happens
  // implicitly when they tap the GPS button again.
  const [hasAnyLocation, setHasAnyLocation] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Leaflet icons are constructed lazily on the client to avoid touching
  // `window` during server-side prerendering.
  const icons = useLeafletIcons();

  // Filter known neighborhoods against the user's query.
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return GUERRARA_LOCATIONS.map((label, idx) => ({ label, idx })).filter(
      (item) => item.label.toLowerCase().includes(q),
    );
  }, [search]);

  const handleSelectPlace = (idx: number, label: string) => {
    const coords = GUERRARA_COORDS[idx] ?? defaultCenter;
    setSearch(label);
    setShowResults(false);
    setFlyTo({ lat: coords.lat, lng: coords.lng, zoom: 16 });
    onSelectPlace?.({ label, lat: coords.lat, lng: coords.lng });
  };

  const handleLocateMe = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setLocateError('GPS غير متاح — انقر على الخريطة لتحديد موقعك يدوياً');
      window.setTimeout(() => setLocateError(null), 3500);
      return;
    }
    setLocating(true);
    setLocateError(null);
    // Some embedded WebViews (notably older Android WebViews when the
    // platform location service is disabled) throw synchronously instead of
    // calling the error callback. Wrap the call so we still surface a clear
    // message rather than crashing the component.
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(coords);
          setHasAnyLocation(true);
          setLocating(false);
        },
        (err) => {
          setLocating(false);
          // Provide actionable copy in every case. The user can still tap
          // the map to pick a location manually if GPS refuses.
          const msg =
            err.code === err.PERMISSION_DENIED
              ? 'تم رفض إذن الموقع — انقر على الخريطة لتحديد موقعك'
              : err.code === err.POSITION_UNAVAILABLE
                ? 'الموقع غير متاح — شغّل GPS أو انقر على الخريطة'
                : 'تعذر تحديد الموقع — انقر على الخريطة للمحاولة يدوياً';
          setLocateError(msg);
          window.setTimeout(() => setLocateError(null), 3500);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } catch {
      setLocating(false);
      setLocateError('خدمة الموقع غير متوفرة — انقر على الخريطة لتحديد موقعك');
      window.setTimeout(() => setLocateError(null), 3500);
    }
  };

  const handleMapClick = (latlng: LatLng) => {
    const coords = { lat: latlng.lat, lng: latlng.lng };
    setManualLocation(coords);
    setHasAnyLocation(true);
    // Reset any lingering GPS error toast — the user found a workaround.
    setLocateError(null);
    setManualToast('تم تحديد موقعك يدوياً');
    window.setTimeout(() => setManualToast(null), 2500);
  };

  const clearSearch = () => {
    setSearch('');
    setShowResults(false);
    searchRef.current?.focus();
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20',
        height,
        className,
      )}
      data-testid="wassilha-interactive-map"
    >
      <MapContainer
        center={[defaultCenter.lat, defaultCenter.lng]}
        zoom={defaultZoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        attributionControl
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pickupCoords && icons ? (
          <Marker
            position={[pickupCoords.lat, pickupCoords.lng]}
            icon={icons.pickup}
          >
            <Popup>
              <strong>نقطة الاستلام</strong>
              {pickupLabel ? <div>{pickupLabel}</div> : null}
            </Popup>
          </Marker>
        ) : null}
        {dropoffCoords && icons ? (
          <Marker
            position={[dropoffCoords.lat, dropoffCoords.lng]}
            icon={icons.dropoff}
          >
            <Popup>
              <strong>نقطة التوصيل</strong>
              {dropoffLabel ? <div>{dropoffLabel}</div> : null}
            </Popup>
          </Marker>
        ) : null}
        {userLocation && icons ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={icons.user}
          >
            <Popup>موقعي الحالي</Popup>
          </Marker>
        ) : null}
        {/* Manual pin: shown only when the user picked a spot on the map and
            we don't already have a live GPS fix. The marker uses a slightly
            different dot (no pulse) so the two states are visually distinct. */}
        {!userLocation && manualLocation && icons ? (
          <Marker
            position={[manualLocation.lat, manualLocation.lng]}
            icon={icons.manual}
          >
            <Popup>موقعك المحدد يدوياً</Popup>
          </Marker>
        ) : null}
        <MapClickHandler onClick={handleMapClick} />
        <MapController
          flyTo={flyTo}
          userLocation={userLocation}
          manualLocation={manualLocation}
          pickup={pickupCoords}
          dropoff={dropoffCoords}
        />
      </MapContainer>

      {/* Permission prompt banner — shown only when the user has neither a
          live GPS fix nor a manual pick. It's intentionally prominent and
          tappable: pressing it triggers the native browser permission
          dialog, and (if granted) immediately asks `getCurrentPosition` for
          a fix. If the user denies, the same banner stays up but the
          in-app error toast will tell them they can tap the map instead. */}
      {!hasAnyLocation ? (
        <button
          type="button"
          onClick={handleLocateMe}
          disabled={locating}
          data-testid="wassilha-permission-button"
          className={cn(
            'pointer-events-auto absolute inset-x-0 top-0 z-[550] flex items-center justify-center gap-2 border-b border-emerald-600/30 bg-emerald-600/95 px-3 py-2 text-xs font-bold text-white shadow-md backdrop-blur transition active:scale-[0.99] hover:bg-emerald-600',
            'dark:bg-emerald-500/95 dark:border-emerald-300/30',
            locating && 'animate-pulse opacity-90',
          )}
          aria-label="allow-location"
        >
          <Navigation size={14} className={locating ? 'animate-spin' : ''} />
          <span>السماح بالوصول لموقعي الحالي</span>
        </button>
      ) : null}

      {/* Top overlay: search bar (right) + GPS button (left) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-center justify-between gap-2 p-2.5">
        {/* Search bar */}
        <div className="pointer-events-auto relative flex-1">
          <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md backdrop-blur dark:bg-slate-900/95 dark:text-slate-200">
            <Search size={14} className="shrink-0 text-primary" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onBlur={() => window.setTimeout(() => setShowResults(false), 150)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
              aria-label="search-location"
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={clearSearch}
                className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="clear-search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          {/* Search results dropdown */}
          {showResults && results.length > 0 ? (
            <div className="absolute inset-x-0 top-full z-[600] mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-border bg-white shadow-2xl dark:bg-slate-900">
              {results.map(({ label, idx }) => (
                <button
                  key={idx}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectPlace(idx, label)}
                  className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-right text-xs font-semibold text-slate-700 last:border-0 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-emerald-950/40"
                >
                  <MapPin size={12} className="shrink-0 text-primary" />
                  <span className="flex-1 truncate">{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* GPS locate-me button */}
        <button
          type="button"
          onClick={handleLocateMe}
          disabled={locating}
          className={cn(
            'pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/95 text-primary shadow-md backdrop-blur transition active:scale-95 dark:bg-slate-900/95',
            locating && 'animate-pulse opacity-80',
          )}
          aria-label="locate-me"
          title="موقعي"
        >
          <Crosshair size={16} className={locating ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Locate error toast (in-map) */}
      {locateError ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-[500] flex justify-center">
          <div className="rounded-full bg-rose-600/95 px-3 py-1 text-[10px] font-bold text-white shadow-lg">
            {locateError}
          </div>
        </div>
      ) : null}

      {/* Manual-pick success toast (in-map). Distinct teal colour so the
          user knows their tap was registered. */}
      {manualToast ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-[500] flex justify-center">
          <div className="rounded-full bg-emerald-600/95 px-3 py-1 text-[10px] font-bold text-white shadow-lg">
            {manualToast}
          </div>
        </div>
      ) : null}

      {/* WASSILHA watermark in the bottom-right corner */}
      <div className="pointer-events-none absolute bottom-2 right-2 z-[400] rounded-full bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold text-white shadow">
        WASSILHA Maps
      </div>
    </div>
  );
}

export default InteractiveMap;
