'use client';

import { useState, useEffect } from 'react';
import { Package, ChevronRight, ChevronLeft, MapPin, Flag } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { useNavStore } from '@/lib/store';
import { CargoIcon, StatusBadge } from '../cargo-icon';
import { Card } from '@/components/ui/card';
import { formatDzd } from '@/lib/wassilha-data';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/lib/types';

export function CustomerHistory() {
  const { t, isAr } = useT();
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');

  useEffect(() => {
    api.listOrders({ role: 'customer' })
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const Chevron = isAr ? ChevronLeft : ChevronRight;

  const statusLabel = (s: OrderStatus) =>
    (t as Record<string, string>)[s === 'searching' ? 'pending' : s === 'accepted' ? 'accepted' : s === 'picked' ? 'inTransit' : s === 'delivered' ? 'delivered' : 'cancelled'];

  const openOrder = (o: Order) => {
    setActiveOrderId(o.id);
    setCustomerTab('track');
  };

  const filters: ('all' | OrderStatus)[] = ['all', 'searching', 'accepted', 'picked', 'delivered', 'cancelled'];

  return (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-black text-foreground">{t.history}</h2>

      {/* Filter chips */}
      <div className="wassilha-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
            )}
          >
            {f === 'all' ? t.all : statusLabel(f)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Package size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">{t.noOrders}</p>
          <button onClick={() => setCustomerTab('home')} className="text-sm font-bold text-primary">
            {t.requestTriporteur}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <Card
              key={o.id}
              className="cursor-pointer p-3 transition hover:shadow-md"
              onClick={() => openOrder(o)}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CargoIcon cargo={o.cargoType} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">{o.code}</span>
                    <StatusBadge status={o.status} label={statusLabel(o.status)} />
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin size={11} className="text-primary" />
                    <span className="truncate">{o.pickup}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Flag size={11} className="text-[#FF7A00]" />
                    <span className="truncate">{o.dropoff}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-black text-primary">{formatDzd(o.price)}</span>
                  <span className="text-[10px] text-muted-foreground">{t.dzd}</span>
                  <Chevron size={16} className="text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
