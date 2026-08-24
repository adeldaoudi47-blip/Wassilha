'use client';

import { useEffect, useState } from 'react';
import { Package, MapPin, Flag, User, Bike } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { CargoIcon, StatusBadge } from '../cargo-icon';
import { formatDzd } from '@/lib/wassilha-data';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/lib/types';

export function AdminOrders() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');

  useEffect(() => {
    api.adminOrders().then(setOrders).catch(() => {}).finally(() => setLoading(false));
    const id = setInterval(() => api.adminOrders().then(setOrders).catch(() => {}), 6000);
    return () => clearInterval(id);
  }, []);

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const statusLabel = (s: OrderStatus) =>
    (t as Record<string, string>)[s === 'searching' ? 'pending' : s === 'accepted' ? 'accepted' : s === 'picked' ? 'inTransit' : s === 'delivered' ? 'delivered' : 'cancelled'];

  const filters: ('all' | OrderStatus)[] = ['all', 'searching', 'accepted', 'picked', 'delivered', 'cancelled'];

  return (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-black text-foreground">{t.manageOrders}</h2>

      {/* Filter chips */}
      <div className="wassilha-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {filters.map((f) => {
          const count = f === 'all' ? orders.length : orders.filter((o) => o.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition',
                filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              )}
            >
              {f === 'all' ? t.all : statusLabel(f)}
              <span className={cn('rounded-full px-1.5 text-[10px]', filter === f ? 'bg-white/20' : 'bg-background/60')}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t.noOrders}</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <Card key={o.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CargoIcon cargo={o.cargoType} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">{o.code}</span>
                    <StatusBadge status={o.status} label={statusLabel(o.status)} />
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <User size={10} className="text-sky-500" />
                      <span className="truncate">{o.customer?.name}</span>
                      {o.driver && (
                        <>
                          <Bike size={10} className="ms-1 text-emerald-500" />
                          <span className="truncate">{o.driver.name}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <MapPin size={10} className="text-primary" />
                      <span className="truncate">{o.pickup}</span>
                      <Flag size={9} className="text-[#FF7A00]" />
                      <span className="truncate">{o.dropoff}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-black text-primary">{formatDzd(o.price)}</span>
                  <span className="text-[9px] text-muted-foreground">{t.dzd}</span>
                  <span className="text-[9px] text-muted-foreground">{o.distance} {t.km}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
