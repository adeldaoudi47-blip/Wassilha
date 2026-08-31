'use client';

/**
 * Skeleton loaders with shimmer animation.
 *
 * These are used in place of plain spinners for the initial load of
 * data-bound screens (admin dashboard, driver applications, driver
 * request feed, etc.) to give a perceived-performance boost — the
 * user sees a structure that matches the final content rather than a
 * blank gap.
 *
 * The shimmer animation lives in `globals.css` under the `.shimmer`
 * class so the keyframes can be reused without re-declaring them on
 * every component.
 */
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

/** A single rounded block with the shimmer gradient. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('shimmer rounded-md bg-muted/40', className)}
    />
  );
}

/**
 * Generic card-shaped skeleton. Matches the visual footprint of the
 * `Card` components used across admin/driver screens so the layout
 * doesn't jump when the real data lands.
 */
export function CardSkeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-2xl border border-border bg-card p-4 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2 w-1/2" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-5/6" />
      </div>
    </div>
  );
}

/**
 * Map placeholder. Mirrors the rounded-2xl card used by the Leaflet
 * wrapper, with a centred crosshair glyph to suggest "loading map
 * tiles". The shimmer gradient matches the brand teal/green palette
 * so the placeholder doesn't feel disconnected from the actual map.
 */
export function MapSkeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'shimmer relative h-52 w-full overflow-hidden rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20',
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary/40 bg-white/80 text-primary shadow-sm dark:bg-slate-900/80">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="22" y1="12" x2="18" y2="12" />
            <line x1="6" y1="12" x2="2" y2="12" />
            <line x1="12" y1="6" x2="12" y2="2" />
            <line x1="12" y1="22" x2="12" y2="18" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/**
 * KPI grid skeleton — 4 metric cards in a 2-column layout, matching
 * the admin dashboard's primary KPI row.
 */
export function KpiSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden
          className="rounded-2xl border border-border bg-card p-3.5"
        >
          <Skeleton className="mb-2 h-9 w-9 rounded-lg" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-1 h-2 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * List of card skeletons — useful for incoming order feed, driver
 * application list, and other stacked list views.
 */
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
