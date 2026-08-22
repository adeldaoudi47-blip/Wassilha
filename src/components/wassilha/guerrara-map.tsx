'use client';

import { useEffect, useState } from 'react';
import { Navigation, Search, Locate, Flag, MapPin, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GUERRARA_LOCATIONS } from '@/lib/wassilha-data';

interface MapPin {
  type: 'pickup' | 'dropoff' | 'driver';
}

interface GuerraraMapProps {
  showDriver?: boolean;
  driverProgress?: number; // 0..1 along the route
  pickupLabel?: string;
  dropoffLabel?: string;
  live?: boolean;
  className?: string;
  height?: string;
}

// Stylized map of El Guerrara drawn with SVG. Not geographically accurate —
// it's a clean, branded schematic like the original app's MapPlaceholder.
export function GuerraraMap({
  showDriver = false,
  driverProgress = 0,
  pickupLabel,
  dropoffLabel,
  live = false,
  className,
  height = 'h-72',
}: GuerraraMapProps) {
  // Route from pickup (top-left area) to dropoff (bottom-right area)
  const pickup = { x: 26, y: 34 };
  const dropoff = { x: 70, y: 62 };
  // Driver interpolates along the path
  const driverX = pickup.x + (dropoff.x - pickup.x) * driverProgress;
  const driverY = pickup.y + (dropoff.y - pickup.y) * driverProgress;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20',
        height,
        className
      )}
    >
      {/* Grid background */}
      <div className="map-grid-bg absolute inset-0" />

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {/* District blocks (soft colored areas) */}
        <rect x="8" y="8" width="22" height="18" rx="2" fill="rgba(14,107,94,0.10)" />
        <rect x="70" y="8" width="22" height="16" rx="2" fill="rgba(255,122,0,0.08)" />
        <rect x="8" y="70" width="20" height="20" rx="2" fill="rgba(14,165,233,0.08)" />
        <rect x="72" y="72" width="20" height="20" rx="2" fill="rgba(14,107,94,0.10)" />
        <rect x="40" y="40" width="20" height="20" rx="2" fill="rgba(139,92,246,0.06)" />

        {/* Roads */}
        <line x1="0" y1="48" x2="100" y2="48" stroke="rgba(14,107,94,0.18)" strokeWidth="2.2" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(14,107,94,0.18)" strokeWidth="2.2" />
        <line x1="0" y1="22" x2="100" y2="22" stroke="rgba(14,107,94,0.10)" strokeWidth="1.2" />
        <line x1="0" y1="78" x2="100" y2="78" stroke="rgba(14,107,94,0.10)" strokeWidth="1.2" />
        <line x1="28" y1="0" x2="28" y2="100" stroke="rgba(14,107,94,0.10)" strokeWidth="1.2" />
        <line x1="72" y1="0" x2="72" y2="100" stroke="rgba(14,107,94,0.10)" strokeWidth="1.2" />

        {/* Dashed route path */}
        <path
          d={`M ${pickup.x} ${pickup.y} Q 45 28, 50 42 T ${dropoff.x} ${dropoff.y}`}
          fill="none"
          stroke="#0E6B5E"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 3"
          className="animate-dash"
        />

        {/* Pickup pin */}
        <g transform={`translate(${pickup.x}, ${pickup.y})`}>
          <circle r="3.5" fill="#0E6B5E" opacity="0.25" className="pulse-ring" />
          <circle r="2.4" fill="#0E6B5E" />
        </g>

        {/* Dropoff pin */}
        <g transform={`translate(${dropoff.x}, ${dropoff.y})`}>
          <circle r="2.4" fill="#FF7A00" />
          <rect x="-1.2" y="-4" width="2.4" height="3" fill="#FF7A00" />
        </g>

        {/* Driver marker */}
        {showDriver && (
          <g transform={`translate(${driverX}, ${driverY})`}>
            <circle r="4.5" fill="#0F172A" opacity="0.18" className="pulse-ring" />
            <circle r="3" fill="#0F172A" stroke="#fff" strokeWidth="1.2" />
          </g>
        )}
      </svg>

      {/* Pickup label chip */}
      <div
        className="absolute -translate-x-1/2 -translate-y-full"
        style={{ left: `${pickup.x}%`, top: `${pickup.y - 4}%` }}
      >
        <div className="flex items-center gap-1 rounded-lg bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-md whitespace-nowrap">
          <MapPin size={10} />
          {pickupLabel ?? GUERRARA_LOCATIONS[0]}
        </div>
      </div>

      {/* Dropoff label chip */}
      <div
        className="absolute -translate-x-1/2 translate-y-full"
        style={{ left: `${dropoff.x}%`, top: `${dropoff.y + 4}%` }}
      >
        <div className="flex items-center gap-1 rounded-lg bg-[#FF7A00] px-2 py-0.5 text-[10px] font-bold text-white shadow-md whitespace-nowrap">
          <Flag size={10} />
          {dropoffLabel ?? GUERRARA_LOCATIONS[1]}
        </div>
      </div>

      {/* Driver floating icon */}
      {showDriver && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${driverX}%`, top: `${driverY}%` }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-2 ring-white">
            <Bike size={14} />
          </div>
        </div>
      )}

      {/* Top overlay: search + locate */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur dark:bg-slate-900/90 dark:text-slate-300">
          <Search size={13} className="text-primary" />
          <span>القرارة، غرداية</span>
          {live && (
            <span className="ms-auto flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE
            </span>
          )}
        </div>
        <button className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/90 text-primary shadow-sm backdrop-blur dark:bg-slate-900/90">
          <Locate size={16} />
        </button>
      </div>

      {/* Distance badge */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1 text-[10px] font-semibold text-white shadow-lg">
          <Navigation size={11} className="text-emerald-400" />
          3.8 كم · ~12 دقيقة
        </div>
      </div>

      {/* Attribution */}
      <div className="absolute bottom-1 right-2 text-[8px] text-slate-400">
        WASSILHA Maps · القرارة UTC+1
      </div>
    </div>
  );
}
