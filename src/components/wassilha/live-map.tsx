'use client';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
const dropoffIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
const driverIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  popupAnchor: [1, -38],
  shadowSize: [41, 41],
});
// "Target / crosshair" SVG icon for the pickup point. Drawn with
// concentric circles + cardinal lines so the rider can see the exact
// pin location at a glance (the classic pickup-pin metaphor used by
// rideshare apps). Anchored at its centre (18,18) so the inner dot
// sits exactly on `pickupCoords`. Markers stay clickable because
// `L.divIcon` renders an HTML element which Leaflet treats like any
// other interactive marker.
const pickupTargetIcon = L.divIcon({
  className: 'wassilha-pickup-target',
  html:
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
    '</div>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20],
});
function MapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 15, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true });
  }, [points, map]);
  return null;
}
export interface LiveMapProps {
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  driverCoords?: { lat: number; lng: number } | null;
  pickupLabel?: string;
  dropoffLabel?: string;
  driverLabel?: string;
  height?: string;
  className?: string;
}
export function LiveMap({
  pickupCoords,
  dropoffCoords,
  driverCoords,
  pickupLabel,
  dropoffLabel,
  driverLabel,
  height = 'h-72',
  className,
}: LiveMapProps) {
  // Real road geometry fetched from the public OSRM demo server. We
  // store the result in state and fall back to a straight line if the
  // network call fails (no connectivity, OSRM rate-limited, or the
  // server is down). OSRM returns [lng, lat]; Leaflet wants [lat, lng].
  const [routeLine, setRouteLine] = useState<[number, number][]>([
    [pickupCoords.lat, pickupCoords.lng],
    [dropoffCoords.lat, dropoffCoords.lng],
  ]);
  const [routeMeta, setRouteMeta] = useState<{
    distanceKm: number | null;
    durationMin: number | null;
    source: 'osrm' | 'fallback';
  }>({ distanceKm: null, durationMin: null, source: 'fallback' });

  useEffect(() => {
    // Same pickup & dropoff – nothing to route, keep the current line.
    if (
      pickupCoords.lat === dropoffCoords.lat &&
      pickupCoords.lng === dropoffCoords.lng
    ) {
      setRouteLine([[pickupCoords.lat, pickupCoords.lng]]);
      setRouteMeta({ distanceKm: 0, durationMin: 0, source: 'osrm' });
      return;
    }

    const ctrl = new AbortController();
    // 10s hard timeout: the public OSRM demo server is often slow /
    // blocked from Algeria; we don't want a hung request to block the
    // UI forever. The AbortController will fire `AbortError` which the
    // catch handler ignores (treated as the user navigating away).
    const timeoutId = window.setTimeout(() => ctrl.abort(), 10_000);

    // Try the public OSRM demo first, fall back to the OSM Germany
    // mirror if it fails. Both expose the same v1/driving endpoint and
    // accept the same lng,lat ordering, so we can share the rest of the
    // pipeline.
    const baseUrls = [
      'https://router.project-osrm.org/route/v1/driving/',
      'https://routing.openstreetmap.de/routed-car/route/v1/driving/',
    ];
    const path =
      `${pickupCoords.lng},${pickupCoords.lat};${dropoffCoords.lng},${dropoffCoords.lat}` +
      `?overview=full&geometries=geojson`;

    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      ctrl.abort();
    };

    (async () => {
      // eslint-disable-next-line no-console
      console.log(
        '[OSRM] Fetching route from',
        `${pickupCoords.lat},${pickupCoords.lng}`,
        '->',
        `${dropoffCoords.lat},${dropoffCoords.lng}`,
      );
      for (let i = 0; i < baseUrls.length; i++) {
        if (cancelled) return;
        const url = baseUrls[i] + path;
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const route = data?.routes?.[0];
          if (
            !route ||
            !Array.isArray(route.geometry?.coordinates) ||
            route.geometry.coordinates.length < 2
          ) {
            throw new Error('OSRM: empty geometry');
          }
          if (cancelled) return;
          // OSRM returns [lng, lat]; Leaflet wants [lat, lng].
          const coords: [number, number][] = route.geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng],
          );
          // eslint-disable-next-line no-console
          console.log(
            '[OSRM] Route found:',
            coords.length,
            'points via',
            i === 0 ? 'project-osrm.org' : 'routing.openstreetmap.de',
          );
          setRouteLine(coords);
          setRouteMeta({
            distanceKm:
              typeof route.distance === 'number' ? route.distance / 1000 : null,
            durationMin:
              typeof route.duration === 'number' ? route.duration / 60 : null,
            source: 'osrm',
          });
          window.clearTimeout(timeoutId);
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError' || cancelled) return;
          // eslint-disable-next-line no-console
          console.warn(
            `[OSRM] Server ${i} failed:`,
            e?.message ?? e,
            i === baseUrls.length - 1 ? '-- using fallback straight line' : '-- trying next',
          );
        }
      }
      // All servers failed -> straight-line fallback so the user still
      // sees pickup/dropoff connected on the map.
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error('[OSRM] Failed, using fallback straight line');
      setRouteLine([
        [pickupCoords.lat, pickupCoords.lng],
        [dropoffCoords.lat, dropoffCoords.lng],
      ]);
      setRouteMeta((m) => ({ ...m, source: 'fallback' }));
    })();

    return cleanup;
  }, [
    pickupCoords.lat,
    pickupCoords.lng,
    dropoffCoords.lat,
    dropoffCoords.lng,
  ]);
  const boundsPoints = useMemo<Array<[number, number]>>(() => {
    const arr: Array<[number, number]> = [
      [pickupCoords.lat, pickupCoords.lng],
      [dropoffCoords.lat, dropoffCoords.lng],
    ];
    if (driverCoords) {
      arr.push([driverCoords.lat, driverCoords.lng]);
    }
    return arr;
  }, [
    pickupCoords.lat,
    pickupCoords.lng,
    dropoffCoords.lat,
    dropoffCoords.lng,
    driverCoords?.lat,
    driverCoords?.lng,
  ]);
  const initialCenter: [number, number] = [
    (pickupCoords.lat + dropoffCoords.lat) / 2,
    (pickupCoords.lng + dropoffCoords.lng) / 2,
  ];
  return (
    <div
      className={[
        'relative overflow-hidden rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20',
        height,
        className ?? '',
      ].filter(Boolean).join(' ')}
      data-testid="wassilha-live-map"
    >
      <MapContainer
        center={initialCenter}
        zoom={14}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        // Visually hide the Leaflet attribution control to keep the map
        // surface clean. The OSM credit is still attached to the
        // <TileLayer> below so we remain license-compliant (it's in the
        // DOM, just not rendered as a strip on top of the map).
        attributionControl={false}
        zoomControl
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={routeLine}
          pathOptions={{
            color: '#2563EB',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round',
            // Real road geometry -> solid; fallback straight line -> dashed.
            dashArray: routeMeta.source === 'osrm' ? undefined : '8 8',
          }}
        />
        <Marker position={[pickupCoords.lat, pickupCoords.lng]} icon={pickupTargetIcon}>
          <Popup>
            <strong>Pickup</strong>
            {pickupLabel ? <div>{pickupLabel}</div> : null}
          </Popup>
        </Marker>
        <Marker position={[dropoffCoords.lat, dropoffCoords.lng]} icon={dropoffIcon}>
          <Popup>
            <strong>Dropoff</strong>
            {dropoffLabel ? <div>{dropoffLabel}</div> : null}
          </Popup>
        </Marker>
        {driverCoords ? (
          <Marker position={[driverCoords.lat, driverCoords.lng]} icon={driverIcon}>
            <Popup>
              <strong>Driver</strong>
              {driverLabel ? <div>{driverLabel}</div> : null}
            </Popup>
          </Marker>
        ) : null}
        <MapBounds points={boundsPoints} />
      </MapContainer>
      {/* WASSILHA watermark removed: the floating "WASSILHA Maps" pill was
          overlapping with the OSM street labels and added no value on the
          tracking screen. Branding lives in the app header. The OSM
          attribution credit remains in the DOM for license compliance. */}
    </div>
  );
}
export default LiveMap;

