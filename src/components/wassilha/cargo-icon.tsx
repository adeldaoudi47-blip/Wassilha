'use client';

import { createElement } from 'react';
import {
  Package, Layers, Store, Sofa, Refrigerator, HardHat,
  Briefcase, CircleEllipsis, type LucideIcon,
} from 'lucide-react';
import type { CargoKey, OrderStatus } from '@/lib/types';
import { CARGO_TYPES } from '@/lib/wassilha-data';

const ICONS: Record<string, LucideIcon> = {
  Package,
  Layers,
  Store,
  Sofa,
  Refrigerator,
  HardHat,
  Briefcase,
  EllipsisHorizontalCircle: CircleEllipsis,
};

export function CargoIcon({ cargo, size = 20, className }: { cargo: CargoKey; size?: number; className?: string }) {
  const meta = CARGO_TYPES.find((c) => c.key === cargo);
  const Icon = (meta && ICONS[meta.icon]) || Package;
  // Use createElement to avoid the static-components lint rule (Icon is a stable module-level ref)
  return createElement(Icon, { size, className, style: { color: meta?.color } });
}

export function cargoColor(cargo: CargoKey): string {
  return CARGO_TYPES.find((c) => c.key === cargo)?.color ?? '#64748B';
}

const STATUS_STYLES: Record<OrderStatus, { bg: string; text: string; dot: string; key: string }> = {
  searching: { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', key: 'pending' },
  accepted: { bg: 'bg-sky-100 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500', key: 'accepted' },
  picked: { bg: 'bg-violet-100 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500', key: 'inTransit' },
  delivered: { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', key: 'delivered' },
  cancelled: { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-500', key: 'cancelled' },
};

export function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === 'searching' || status === 'accepted' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}
