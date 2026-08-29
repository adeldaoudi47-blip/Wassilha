'use client';

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

import type { AdminDriverLocation } from "@/lib/types";

// Marker icon for live (recent fix) drivers - green bike
const liveIcon = new L.DivIcon({
  className: "wassilha-fleet-marker",
  html: '<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#10B981;border:3px solid #fff;border-radius:9999px;box-shadow:0 2px 6px rgba(0,0,0,0.3);"><span style="font-size:14px;line-height:1;color:#fff;">&#128690;</span></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

// Stale (old fix) drivers get an amber outline so the admin notices
// they are not actively broadcasting right now.
const staleIcon = new L.DivIcon({
  className: "wassilha-fleet-marker",
  html: '<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#F59E0B;border:3px solid #fff;border-radius:9999px;box-shadow:0 2px 6px rgba(0,0,0,0.3);opacity:0.7;"><span style="font-size:14px;line-height:1;color:#fff;">&#128690;</span></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

function ageSeconds(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
}

// Re-centers the map whenever the drivers list changes. Uses fitBounds
// so all markers stay visible regardless of count.
function MapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
  }, [points, map]);
  return null;
}

export interface FleetMapLabels {
  rating: string;
  trips: string;
  lastSeen: string;
  vehicle: string;
  online: string;
  offline: string;
  live: string;
  stale: string;
  phone: string;
}

export interface FleetMapInnerProps {
  drivers: AdminDriverLocation[];
  staleAfterS: number;
  labels: FleetMapLabels;
}

export function FleetMapInner({ drivers, staleAfterS, labels }: FleetMapInnerProps) {
  // Build the points array, sorted by lastSeenAt desc so the most
  // recently active drivers show on top in the stacking order.
  const points = useMemo<Array<[number, number]>>(
    () => drivers.map((d) => [d.currentLat, d.currentLng] as [number, number]),
    [drivers]
  );

  // Default to El Guerrara, Ghardaia (the apps home turf) when no
  // drivers are online yet, so the map does not start at (0,0).
  const FALLBACK_CENTER: [number, number] = [32.7833, 3.7667];
  const center: [number, number] = points.length > 0 ? points[0] : FALLBACK_CENTER;

  return (
    <div
      className="relative h-96 overflow-hidden rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20"
      data-testid="wassilha-fleet-map"
    >
      <MapContainer
        center={center}
        zoom={points.length > 0 ? 13 : 11}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        attributionControl
        zoomControl
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {drivers.map((d) => {
          const isStale = ageSeconds(d.lastSeenAt) > staleAfterS;
          const icon = isStale ? staleIcon : liveIcon;
          const statusLabel = isStale ? labels.stale : labels.live;
          return (
            <Marker
              key={d.id}
              position={[d.currentLat, d.currentLng]}
              icon={icon}
            >
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                    {d.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6 }}>
                    {labels.phone}: {d.phone}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px", fontSize: 11 }}>
                    <span style={{ color: "#64748B" }}>{labels.rating}:</span>
                    <span>&#9733; {d.rating.toFixed(1)}</span>
                    <span style={{ color: "#64748B" }}>{labels.trips}:</span>
                    <span>{d.totalTrips}</span>
                    {d.vehicleLabel ? (
                      <>
                        <span style={{ color: "#64748B" }}>{labels.vehicle}:</span>
                        <span>{d.vehicleLabel}</span>
                      </>
                    ) : null}
                    <span style={{ color: "#64748B" }}>{labels.lastSeen}:</span>
                    <span>{new Date(d.lastSeenAt).toLocaleTimeString()}</span>
                    <span style={{ color: "#64748B" }}>{labels.online}:</span>
                    <span style={{ color: isStale ? "#F59E0B" : "#10B981", fontWeight: 600 }}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        <MapBounds points={points} />
      </MapContainer>
      <div className="pointer-events-none absolute right-2 top-2 z-[400] rounded-full bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold text-white shadow">
        WASSILHA Fleet
      </div>
    </div>
  );
}

export default FleetMapInner;
