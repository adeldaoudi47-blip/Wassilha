'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Search, Bike, Package, CheckCircle2, Phone, MessageCircle, Star,
  XCircle, Clock, Navigation, MapPin, Flag,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useNavStore } from '@/lib/store';
import { onOrderStatus, onDriverLocation, subscribeToOrder, unsubscribeFromOrder } from '@/lib/realtime';
// LiveMap is dynamically imported with ssr:false because Leaflet touches
// `window` at module init. The bundled component is loaded only on the
// client; during SSR a lightweight placeholder div is rendered.
const LiveMap = dynamic(
  () => import('../live-map').then((m) => m.LiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-56 w-full animate-pulse rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20" />
    ),
  },
);
// Keep the old import for screens that still rely on it (e.g. customer-home
// preview). We do not render it on this page anymore.
import { GuerraraMap } from '../guerrara-map';
import { CargoIcon, StatusBadge } from '../cargo-icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { formatDzd } from '@/lib/wassilha-data';
import type { Order, OrderStatus } from '@/lib/types';

const STEPS: { key: OrderStatus; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'searching', icon: Search },
  { key: 'accepted', icon: Bike },
  { key: 'picked', icon: Package },
  { key: 'delivered', icon: CheckCircle2 },
];

const STEP_ORDER: OrderStatus[] = ['searching', 'accepted', 'picked', 'delivered'];

export function CustomerTrack() {
  const { t, isAr } = useT();
  const activeOrderId = useNavStore((s) => s.activeOrderId);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverProgress, setDriverProgress] = useState(0);
  // Latest GPS fix broadcasted by the driver via socket.io. We use this
  // (instead of the abstract progress value) to position the driver marker
  // on the real Leaflet map.
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrder = useCallback(async () => {
    if (!activeOrderId) {
      // no active order — try to find latest searching/accepted/picked
      try {
        const orders = await api.listOrders({ role: 'customer' });
        const active = orders.find((o) => ['searching', 'accepted', 'picked'].includes(o.status));
        if (active) {
          setOrder(active);
          useNavStore.getState().setActiveOrderId(active.id);
        } else {
          setOrder(null);
        }
      } catch {
        setOrder(null);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const o = await api.getOrder(activeOrderId);
      setOrder(o);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [activeOrderId]);

  useEffect(() => {
    loadOrder();
    // Poll every 4s as a fallback to websocket
    pollRef.current = setInterval(loadOrder, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadOrder]);

  // Realtime: listen for order status + driver location
  useEffect(() => {
    const offStatus = onOrderStatus((updated) => {
      if (order && updated.id === order.id) {
        setOrder(updated);
        if (updated.status === 'delivered') {
          toast.success(t.delivered);
        }
      }
    });
    const offLoc = onDriverLocation((p) => {
      if (order && p.orderId === order.id) {
        // Update the real GPS marker. We still keep `driverProgress` so
        // any non-map UI (e.g. progress bar) keeps working.
        setDriverCoords({ lat: p.lat, lng: p.lng });
        setDriverProgress((prev) => Math.min(1, prev + 0.08));
      }
    });
    return () => {
      offStatus();
      offLoc();
    };
  }, [order, t.delivered]);

  // Subscribe to order location stream when accepted/picked
  useEffect(() => {
    if (order && (order.status === 'accepted' || order.status === 'picked')) {
      subscribeToOrder(order.id);
      setDriverProgress(0.15);
      // Reset live driver marker so we don't show a stale position from a
      // previous ride on the new one.
      setDriverCoords(null);
      return () => unsubscribeFromOrder(order.id);
    }
  }, [order?.id, order?.status]);

  // Seed the live driver marker with the last known position persisted on
  // the Driver row (if any) so the map shows something useful before the
  // first socket.io tick arrives.
  useEffect(() => {
    if (!order || !order.driverId) return;
    if (driverCoords) return; // already have a fresher value
    if (order.status !== 'accepted' && order.status !== 'picked') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/driver/location/${order.driverId}`, {
          cache: 'no-store',
        });
        if (!r.ok) return;
        const j = (await r.json()) as {
          currentLat?: number | null;
          currentLng?: number | null;
        };
        if (
          !cancelled &&
          typeof j.currentLat === 'number' &&
          typeof j.currentLng === 'number'
        ) {
          setDriverCoords({ lat: j.currentLat, lng: j.currentLng });
        }
      } catch {
        // Ignore — socket.io will deliver the first live tick shortly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id, order?.status, order?.driverId, driverCoords]);

  const currentStepIdx = order ? STEP_ORDER.indexOf(order.status) : -1;

  const handleCancel = async () => {
    if (!order) return;
    try {
      const updated = await api.cancelOrder(order.id);
      setOrder(updated);
      toast.success(isAr ? 'تم إلغاء الطلب' : 'Commande annulée');
    } catch {
      toast.error(isAr ? 'فشل الإلغاء' : 'Échec');
    } finally {
      setCancelOpen(false);
    }
  };

  const handleRate = async () => {
    if (!order) return;
    try {
      await api.rateOrder(order.id, rating);
      toast.success(t.thankYou);
      setRateOpen(false);
      setCustomerTab('history');
    } catch {
      toast.error(isAr ? 'فشل التقييم' : 'Échec');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Package size={28} className="text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-muted-foreground">{t.noOrders}</p>
        <Button onClick={() => setCustomerTab('home')} size="sm" className="bg-primary">
          {t.requestTriporteur}
        </Button>
      </div>
    );
  }

  const driverName = order.driver?.name;
  const showDriver = order.status === 'accepted' || order.status === 'picked';

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 p-3.5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t.orderCode}</p>
            <p className="font-mono text-sm font-bold text-foreground">{order.code}</p>
          </div>
          <StatusBadge status={order.status} label={(t as unknown as Record<string, string>)[order.status === 'searching' ? 'pending' : order.status === 'accepted' ? 'accepted' : order.status === 'picked' ? 'inTransit' : order.status === 'delivered' ? 'delivered' : 'cancelled']} />
        </div>

        {/* Map */}
        <div className="p-3">
          {order.pickupLat != null && order.pickupLng != null &&
           order.dropoffLat != null && order.dropoffLng != null ? (
            <LiveMap
              pickupCoords={{ lat: order.pickupLat, lng: order.pickupLng }}
              dropoffCoords={{ lat: order.dropoffLat, lng: order.dropoffLng }}
              driverCoords={showDriver ? driverCoords : null}
              pickupLabel={order.pickup}
              dropoffLabel={order.dropoff}
              driverLabel={driverName ?? undefined}
              height="h-56"
            />
          ) : (
            // Fallback to the SVG schematic if the order has no real coords
            // yet (legacy rows or tests with stub data).
            <GuerraraMap
              showDriver={showDriver}
              driverProgress={driverProgress}
              pickupLabel={order.pickup}
              dropoffLabel={order.dropoff}
              live={showDriver}
              height="h-56"
            />
          )}
        </div>

        {/* Searching / Driver found box */}
        {order.status === 'searching' ? (
          <div className="flex items-center gap-3 p-4">
            <div className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute h-10 w-10 rounded-full bg-primary/20 pulse-ring" />
              <Search size={20} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">{t.searchingDriver}</p>
              <p className="text-xs text-muted-foreground">{t.searchingDriverSub}</p>
            </div>
          </div>
        ) : showDriver && order.driver ? (
          <div className="flex items-center gap-3 p-4">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              {driverName?.charAt(0)}
              <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">{driverName}</p>
              <p className="text-xs text-muted-foreground">⭐ 4.9 · Triporteur 125cc</p>
            </div>
            <div className="flex gap-2">
              <button className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                <Phone size={17} />
              </button>
              <button className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow">
                <MessageCircle size={17} />
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Timeline */}
      <Card className="p-4">
        <p className="mb-4 text-xs font-bold text-muted-foreground">{t.orderProgress}</p>
        <div className="relative flex justify-between">
          {/* connector line */}
          <div className="absolute top-4 inset-inline-0 h-0.5 bg-muted" style={{ marginInlineStart: '6%', marginInlineEnd: '6%' }} />
          <div
            className="absolute top-4 h-0.5 bg-primary transition-all duration-500"
            style={{
              insetInlineStart: '6%',
              width: `${Math.max(0, currentStepIdx) * 29}%`,
            }}
          />
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const done = idx <= currentStepIdx;
            const current = idx === currentStepIdx;
            return (
              <div key={step.key} className="relative z-10 flex flex-1 flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition',
                    done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground',
                    current && 'ring-4 ring-primary/20'
                  )}
                >
                  <Icon size={14} />
                </div>
                <span className={cn('text-[9px] font-semibold text-center leading-tight', done ? 'text-primary' : 'text-muted-foreground')}>
                  {(t.status as Record<string, string>)[step.key]}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Order details */}
      <Card className="divide-y divide-border p-0">
        <DetailRow icon={<CargoIcon cargo={order.cargoType} size={15} />} label={t.cargoLabel} value={`${(t.cargo as Record<string, string>)[order.cargoType]} · ${order.weight} ${t.kg}`} />
        <DetailRow icon={<MapPin size={15} className="text-primary" />} label={t.pickup} value={order.pickup} />
        <DetailRow icon={<Flag size={15} className="text-[#FF7A00]" />} label={t.dropoff} value={order.dropoff} />
        <DetailRow icon={<Navigation size={15} className="text-sky-500" />} label={t.distance} value={`${order.distance} ${t.km}`} />
        <DetailRow
          icon={<Clock size={15} className="text-muted-foreground" />}
          label={t.date}
          value={new Date(order.createdAt).toLocaleString(isAr ? 'ar-DZ' : 'fr-DZ', { dateStyle: 'medium', timeStyle: 'short' })}
        />
        {order.notes && (
          <div className="p-3.5">
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t.notes}</p>
            <p className="text-sm text-foreground">{order.notes}</p>
          </div>
        )}
        <div className="flex items-center justify-between p-3.5">
          <span className="text-sm font-bold text-foreground">{t.estimate}</span>
          <span className="text-xl font-black text-primary">{formatDzd(order.price)} {t.dzd}</span>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        {order.status === 'delivered' && !order.rating && (
          <Button onClick={() => setRateOpen(true)} className="flex-1 bg-primary">
            <Star size={17} className="me-2" /> {t.rateDriver}
          </Button>
        )}
        {['searching', 'accepted'].includes(order.status) && (
          <Button onClick={() => setCancelOpen(true)} variant="outline" className="flex-1 border-destructive text-destructive">
            <XCircle size={17} className="me-2" /> {t.cancelOrder}
          </Button>
        )}
        {['delivered', 'cancelled'].includes(order.status) && (
          <Button onClick={() => setCustomerTab('home')} variant="outline" className="flex-1">
            {t.requestTriporteur}
          </Button>
        )}
      </div>

      {/* Cancel dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.cancelOrder}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmCancel}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.keepOrder}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.yesCancel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rate dialog */}
      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t.rateDriver}</DialogTitle>
            <DialogDescription>{t.rateHint}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-2 py-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={cn('transition-transform hover:scale-110', n <= rating ? 'text-amber-400' : 'text-muted')}
              >
                <Star size={32} fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={handleRate} className="w-full bg-primary">
              {t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="ms-auto text-end text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
