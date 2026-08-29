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
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${pickupCoords.lng},${pickupCoords.lat};${dropoffCoords.lng},${dropoffCoords.lat}` +
      `?overview=full&geometries=geojson`;

    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const route = data?.routes?.[0];
        if (!route || !Array.isArray(route.geometry?.coordinates)) {
          throw new Error('OSRM: no route');
        }
        const coords: [number, number][] = route.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng],
        );
        setRouteLine(coords);
        setRouteMeta({
          distanceKm:
            typeof route.distance === 'number' ? route.distance / 1000 : null,
          durationMin:
            typeof route.duration === 'number' ? route.duration / 60 : null,
          source: 'osrm',
        });
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        // Fallback: straight line. We keep the previous `routeMeta.source`
        // marker as 'fallback' so the UI can show a small disclaimer if
        // desired.
        setRouteLine([
          [pickupCoords.lat, pickupCoords.lng],
          [dropoffCoords.lat, dropoffCoords.lng],
        ]);
        setRouteMeta((m) => ({ ...m, source: 'fallback' }));
      });

    return () => ctrl.abort();
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
        attributionControl
        zoomControl
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={routeLine}
          pathOptions={{
            color: '#0E6B5E',
            weight: 4,
            opacity: 0.85,
            // Real road geometry → solid; fallback straight line → dashed.
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
      <div className="pointer-events-none absolute right-2 top-2 z-[400] rounded-full bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold text-white shadow">
        WASSILHA Maps
      </div>
    </div>
  );
}
export default LiveMap;

