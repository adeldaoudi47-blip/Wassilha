import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Package, MapPin, Flag, Navigation, Bike, Phone, MessageCircle,
  PackageCheck, AlertTriangle, Radio, Gauge, Crosshair,
} from "lucide-react";
import { useT } from "../use-t";
import { useDriverLocation } from "../use-driver-location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDzd } from "@/lib/wassilha-data";
import type { Order, OrderStatus } from "@/lib/types";

// Leaflet touches window at module init so the map is loaded only on the
// client. While the JS chunk is being fetched we render a thin skeleton.
const LiveMap = dynamic(
  () => import("../live-map").then((m) => m.LiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-border bg-muted/40 text-xs text-muted-foreground">
        Map…
      </div>
    ),
  },
);

export interface ActiveTripProps {
  active: Order;
  driverId: string | null;
  statusLabel: (s: OrderStatus) => string;
  onPickup: () => void;
  onDeliver: () => void;
  acting: boolean;
}


export function ActiveTrip({
  active,
  statusLabel,
  onPickup,
  onDeliver,
  acting,
}: ActiveTripProps) {
  const { t, isAr } = useT();

  // Real GPS via navigator.geolocation.watchPosition, throttled to one
  // POST every 5s. The hook itself handles teardown on unmount.
  const { fix, error, loading: gpsLoading, sentCount, retry } = useDriverLocation({
    enabled: true,
    orderId: active.id,
  });

  // Force the LiveMap to re-fit its bounds whenever the driver marker
  // first appears — the map may have been mounted with only pickup +
  // dropoff visible.
  const driverCoords = useMemo(
    () => (fix ? { lat: fix.lat, lng: fix.lng } : null),
    [fix?.lat, fix?.lng],
  );

  const pickupCoords = useMemo(
    () => ({ lat: active.pickupLat, lng: active.pickupLng }),
    [active.pickupLat, active.pickupLng],
  );
  const dropoffCoords = useMemo(
    () => ({ lat: active.dropoffLat, lng: active.dropoffLng }),
    [active.dropoffLat, active.dropoffLng],
  );

  const speedKmh = fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null;

  // Localised error message; falls back to the generic gpsError string.
  const gpsErrorText = useMemo(() => {
    if (!error) return null;
    if (error.code === "denied") return t.gpsDenied;
    if (error.code === "unsupported") return t.gpsUnavailable;
    if (error.code === "timeout") return t.gpsTimeout;
    if (error.code === "http") return t.gpsError;
    return t.gpsError;
  }, [error, t]);

  // Whether the map has real coords to show. Guards against an order
  // that was created before we started persisting lat/lng.
  const hasRouteCoords =
    Number.isFinite(pickupCoords.lat) && Number.isFinite(pickupCoords.lng) &&
    Number.isFinite(dropoffCoords.lat) && Number.isFinite(dropoffCoords.lng);


  return (
    <Card className="overflow-hidden p-0 ring-2 ring-primary/30">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-primary to-brand-dark p-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bike size={18} />
          <span className="text-sm font-bold">{isAr ? "رحلة نشطة" : "Course active"}</span>
        </div>
        <span className="font-mono text-xs font-bold">{active.code}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* GPS status banner */}
        <GpsBanner
          loading={gpsLoading}
          errorText={gpsErrorText}
          hasFix={!!fix}
          sentCount={sentCount}
          onRetry={retry}
        />

        {/* Customer info */}
        {active.customer && (
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {active.customer.name.charAt(0)}
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">{active.customer.name}</p>
              <p className="text-xs text-muted-foreground" dir="ltr">+213 {active.customer.phone}</p>
            </div>
            <div className="flex gap-1.5">
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow" type="button">
                <Phone size={15} />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow" type="button">
                <MessageCircle size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Route summary */}
        <div className="space-y-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <MapPin size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t.pickup}</p>
              <p className="truncate text-sm font-bold text-foreground">{active.pickup}</p>
            </div>
          </div>
          <div className="ms-3.5 h-3 w-px bg-gradient-to-b from-emerald-500/40 to-orange-500/40" />
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-600">
              <Flag size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t.dropoff}</p>
              <p className="truncate text-sm font-bold text-foreground">{active.dropoff}</p>
            </div>
          </div>
        </div>

        {/* Live map */}
        {hasRouteCoords ? (
          <LiveMap
            pickupCoords={pickupCoords}
            dropoffCoords={dropoffCoords}
            driverCoords={driverCoords}
            pickupLabel={active.pickup}
            dropoffLabel={active.dropoff}
            driverLabel={t.liveLocation}
            height="h-72"
          />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
            {isAr ? "لا توجد إحداثيات لهذه الرحلة" : "Pas de coordonnées pour cette course"}
          </div>
        )}

        {/* GPS telemetry */}
        <GpsTelemetry fix={fix} speedKmh={speedKmh} />

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted p-2 text-center">
            <Navigation size={13} className="mx-auto text-emerald-500" />
            <p className="mt-0.5 text-sm font-bold text-foreground">{active.distance} {t.km}</p>
          </div>
          <div className="rounded-lg bg-muted p-2 text-center">
            <Package size={13} className="mx-auto text-violet-500" />
            <p className="mt-0.5 text-sm font-bold text-foreground">{active.weight} {t.kg}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-center">
            <p className="text-sm font-black text-primary">{formatDzd(active.price)}</p>
            <p className="text-[9px] text-muted-foreground">{t.dzd}</p>
          </div>
        </div>

        {/* Action button */}
        {active.status === "accepted" ? (
          <Button
            onClick={onPickup}
            disabled={acting}
            className="w-full bg-[#FF7A00] hover:bg-[#E66A00]"
          >
            <PackageCheck size={18} className="me-2" />
            {isAr ? "تأكيد استلام الحمولة" : "Confirmer ramassage"}
          </Button>
        ) : (
          <Button
            onClick={onDeliver}
            disabled={acting}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            <PackageCheck size={18} className="me-2" />
            {isAr ? "تأكيد التوصيل" : "Confirmer livraison"}
          </Button>
        )}
      </div>
    </Card>
  )
}

// Small inline GPS status banner shown above the map. Stays green while
// we have a fix, switches to amber while we wait for the first fix, and
// turns red with a retry button if the browser denied / lost permission.
function GpsBanner({
  loading,
  errorText,
  hasFix,
  sentCount,
  onRetry,
}: {
  loading: boolean;
  errorText: string | null;
  hasFix: boolean;
  sentCount: number;
  onRetry: () => void;
}) {
  const { t, isAr } = useT();

  if (errorText) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-red-700 dark:text-red-300">
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} />
          <p className="text-xs font-semibold leading-tight">{errorText}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow"
        >
          {isAr ? "حاول مجدداً" : "Réessayer"}
        </button>
      </div>
    )
  }

  return (
    <div
      className={[
        "flex items-center justify-between gap-2 rounded-xl border p-2.5 text-xs",
        hasFix
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        {hasFix ? <Radio size={14} /> : <Crosshair size={14} />}
        <p className="font-semibold">
          {hasFix
            ? (isAr ? "GPS متصل" : "GPS actif")
            : (loading ? t.gpsActivating : t.waitingForGps)}
        </p>
      </div>
      <p className="text-[10px] font-bold opacity-80">
        {sentCount > 0
          ? `${sentCount} ${isAr ? "إشارة" : "pings"}`
          : ""}
      </p>
    </div>
  )
}

// Compact live GPS telemetry row: speed + accuracy.
function GpsTelemetry({
  fix,
  speedKmh,
}: {
  fix: import("../use-driver-location").DriverFix | null;
  speedKmh: number | null;
}) {
  const { t, isAr } = useT();
  if (!fix) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
        <Gauge size={13} className="text-primary" />
        <div className="leading-tight">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {isAr ? "السرعة" : "Vitesse"}
          </p>
          <p className="text-sm font-black text-foreground">
            {speedKmh != null ? `${speedKmh.toFixed(0)} ${t.kmh}` : "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
        <Crosshair size={13} className="text-primary" />
        <div className="leading-tight">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {t.accuracy}
          </p>
          <p className="text-sm font-black text-foreground">
            {fix.accuracy != null ? `±${fix.accuracy.toFixed(0)} ${t.meters}` : "—"}
          </p>
        </div>
      </div>
    </div>
  )
}

