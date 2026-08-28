'use client';
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
const pickupIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
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
  const routeLine = useMemo<[number, number][]>(
    () => [
      [pickupCoords.lat, pickupCoords.lng],
      [dropoffCoords.lat, dropoffCoords.lng],
    ],
    [pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng],
  );
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
          pathOptions={{ color: '#0E6B5E', weight: 4, opacity: 0.8, dashArray: '8 8' }}
        />
        <Marker position={[pickupCoords.lat, pickupCoords.lng]} icon={pickupIcon}>
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

