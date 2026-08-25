'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Package, MapPin, Flag, Navigation, Bike, CheckCircle2, Phone,
  MessageCircle, Play, PackageCheck, Star,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useNavStore } from '@/lib/store';
import { emitOrderStatus, startDriverTrack, stopDriverTrack } from '@/lib/realtime';
import { CargoIcon, StatusBadge } from '../cargo-icon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDzd, GUERRARA_COORDS, GUERRARA_LOCATIONS } from '@/lib/wassilha-data';
import type { Order, OrderStatus } from '@/lib/types';

export function DriverTrips() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listOrders({ role: 'driver' });
      setOrders(list);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const active = orders.find((o) => o.status === 'accepted' || o.status === 'picked');
  const past = orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled');

  const statusLabel = (s: OrderStatus) =>
    (t as unknown as Record<string, string>)[s === 'searching' ? 'pending' : s === 'accepted' ? 'accepted' : s === 'picked' ? 'inTransit' : s === 'delivered' ? 'delivered' : 'cancelled'];

  const refresh = async (id: string) => {
    try {
      const updated = await api.getOrder(id);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch { /* ignore */ }
  };

  const handlePickup = async (order: Order) => {
    setActing(order.id);
    try {
      const updated = await api.pickupOrder(order.id);
      emitOrderStatus(updated);
      toast.success(isAr ? 'تم استلام الحمولة' : 'Cargaison ramassée');
      await refresh(order.id);
    } catch {
      toast.error(isAr ? 'فشل' : 'Échec');
    } finally {
      setActing(null);
    }
  };

  const handleDeliver = async (order: Order) => {
    setActing(order.id);
    try {
      const updated = await api.deliverOrder(order.id);
      emitOrderStatus(updated);
      stopDriverTrack(order.id);
      toast.success(isAr ? 'تم التوصيل! 🎉' : 'Livré! 🎉');
      await refresh(order.id);
    } catch {
      toast.error(isAr ? 'فشل' : 'Échec');
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-lg font-black text-foreground">{t.myTrips}</h2>

      {/* Active trip */}
      {active ? (
        <Card className="overflow-hidden p-0 ring-2 ring-primary/30">
          <div className="flex items-center justify-between bg-gradient-to-r from-primary to-brand-dark p-3 text-primary-foreground">
            <div className="flex items-center gap-2">
              <Bike size={18} />
              <span className="text-sm font-bold">{isAr ? 'رحلة نشطة' : 'Course active'}</span>
            </div>
            <span className="font-mono text-xs font-bold">{active.code}</span>
          </div>

          <div className="p-4 space-y-3">
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
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                    <Phone size={15} />
                  </button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow">
                    <MessageCircle size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Route */}
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <MapPin size={16} className="mt-0.5 text-primary" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">{t.pickup}</p>
                  <p className="text-sm font-semibold text-foreground">{active.pickup}</p>
                </div>
              </div>
              <div className="ms-2 h-4 border-s-2 border-dashed border-border" />
              <div className="flex items-start gap-2.5">
                <Flag size={16} className="mt-0.5 text-[#FF7A00]" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">{t.dropoff}</p>
                  <p className="text-sm font-semibold text-foreground">{active.dropoff}</p>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted p-2 text-center">
                <Navigation size={13} className="mx-auto text-sky-500" />
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
            {active.status === 'accepted' ? (
              <Button
                onClick={() => handlePickup(active)}
                disabled={acting === active.id}
                className="w-full bg-[#FF7A00] hover:bg-[#E66A00]"
              >
                <PackageCheck size={18} className="me-2" />
                {isAr ? 'تأكيد استلام الحمولة' : 'Confirmer ramassage'}
              </Button>
            ) : (
              <Button
                onClick={() => handleDeliver(active)}
                disabled={acting === active.id}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 size={18} className="me-2" />
                {isAr ? 'تأكيد التوصيل' : 'Confirmer livraison'}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Bike size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">{t.noTrips}</p>
        </Card>
      )}

      {/* Past trips */}
      {past.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-xs font-bold text-muted-foreground">{isAr ? 'الرحلات السابقة' : 'Courses passées'}</h3>
          <div className="space-y-2">
            {past.map((o) => (
              <Card key={o.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <CargoIcon cargo={o.cargoType} size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold">{o.code}</span>
                      <StatusBadge status={o.status} label={statusLabel(o.status)} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{o.pickup} → {o.dropoff}</p>
                    {o.rating && (
                      <p className="mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold text-amber-500">
                        <Star size={10} fill="currentColor" /> {o.rating}
                      </p>
                    )}
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-black text-primary">{formatDzd(o.price)}</p>
                    <p className="text-[10px] text-muted-foreground">{t.dzd}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
