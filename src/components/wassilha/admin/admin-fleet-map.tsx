'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, RefreshCw, Wifi, WifiOff, Bike } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AdminDriverLocation } from '@/lib/types';

// Leaflet touches `window` at module init, so the inner map component
// is loaded only on the client. Mirrors the dynamic-import pattern used
// in the driver active-trip map (see `active-trip.tsx`).
const FleetMap = dynamic(
  () => import("./fleet-map-inner").then((m) => m.FleetMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    ),
  }
);

const POLL_INTERVAL_MS = 15_000; // 15s - keeps markers smooth without flooding
const STALE_AFTER_S = 2 * 60;     // 2 min - past this, the marker dims

function ageSeconds(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
}

export function AdminFleetMap() {
  const { t, isAr } = useT();
  const [drivers, setDrivers] = useState<AdminDriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  const load = async () => {
    // Avoid stacking polls: if the previous request has not returned
    // yet (slow network, server hiccup) we skip the new one rather
    // than queueing more fetches.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await api.adminDriverLocations();
      setDrivers(data);
      setError(null);
      setLastFetchedAt(Date.now());
    } catch {
      setError("fetchError");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Recompute "stale" status every 30s without re-fetching. Drivers
  // that are still in `drivers` but whose lastSeenAt is older than
  // 2 minutes are dimmed so the admin notices a stale fix even between
  // polls.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    let live = 0;
    let stale = 0;
    for (const d of drivers) {
      if (ageSeconds(d.lastSeenAt) > STALE_AFTER_S) stale++;
      else live++;
    }
    return { live, stale, total: drivers.length };
  }, [drivers]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-black text-foreground">{t.fleetMap}</h2>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted/80 disabled:opacity-50"
          aria-label="refresh"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          {t.refresh}
        </button>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          icon={<Wifi size={14} className="text-emerald-500" />}
          value={String(counts.live)}
          label={t.live}
          tone="emerald"
        />
        <Stat
          icon={<WifiOff size={14} className="text-amber-500" />}
          value={String(counts.stale)}
          label={t.stale}
          tone="amber"
        />
        <Stat
          icon={<Bike size={14} className="text-sky-500" />}
          value={String(counts.total)}
          label={t.totalDrivers}
          tone="sky"
        />
      </div>

      {/* Map */}
      {error ? (
        <Card className="p-4 text-center text-sm text-red-600 dark:text-red-400">
          {t.fetchError}
        </Card>
      ) : drivers.length === 0 && !loading ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <MapPin size={32} className="text-muted-foreground/40" />
          <p className="text-sm font-semibold text-foreground">{t.noDriversOnline}</p>
          <p className="text-xs text-muted-foreground">{t.noDriversHint}</p>
        </Card>
      ) : (
        <FleetMap
          drivers={drivers}
          staleAfterS={STALE_AFTER_S}
          labels={{
            rating: t.rating,
            trips: t.trips,
            lastSeen: t.lastSeen,
            vehicle: t.vehicle,
            online: t.online,
            offline: t.offline,
            live: t.live,
            stale: t.stale,
            phone: t.phone,
          }}
        />
      )}

      {/* Footer */}
      {lastFetchedAt ? (
        <p className="px-1 text-center text-[10px] text-muted-foreground">
          {t.lastUpdate}{" "}
          {new Date(lastFetchedAt).toLocaleTimeString(isAr ? "ar-DZ" : "fr-DZ")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone: "emerald" | "amber" | "sky";
}) {
  const toneClass: Record<typeof tone, string> = {
    emerald: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/50",
    amber: "bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/50",
    sky: "bg-sky-50 dark:bg-sky-950/30 border-sky-200/60 dark:border-sky-900/50",
  };
  return (
    <Card
      className={cn(
        "flex flex-col items-center gap-0.5 border p-2.5 text-center",
        toneClass[tone]
      )}
    >
      {icon}
      <p className="text-base font-black text-foreground">{value}</p>
      <p className="text-[9px] font-semibold leading-tight text-muted-foreground">{label}</p>
    </Card>
  );
}
