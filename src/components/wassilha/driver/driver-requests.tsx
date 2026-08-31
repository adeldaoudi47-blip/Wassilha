'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bike, Wifi, WifiOff, Package, MapPin, Flag, Scale, Navigation,
  Check, X, Bell, BellOff, Zap,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useNavStore, useAppStore } from '@/lib/store';
import { onOrderNewRequest } from '@/lib/realtime';
import { CargoIcon } from '../cargo-icon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatDzd } from '@/lib/wassilha-data';
import type { DriverProfile, Order } from '@/lib/types';
import { ListSkeleton, Skeleton } from '../skeleton';

export function DriverRequests() {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const setDriverTab = useNavStore((s) => s.setDriverTab);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [incoming, setIncoming] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [p, inc] = await Promise.all([api.driverProfile(), api.incomingOrders()]);
      setProfile(p);
      setIncoming(inc);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll incoming orders every 5s as a realtime fallback
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const inc = await api.incomingOrders();
        setIncoming(inc);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Realtime: listen for new order requests
  useEffect(() => {
    const off = onOrderNewRequest((order) => {
      setIncoming((prev) => prev.some((o) => o.id === order.id) ? prev : [order, ...prev]);
      if (profile?.isOnline) {
        toast.custom((id) => (
          <div className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-xl ring-1 ring-border">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Bell size={16} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-foreground">{t.newOrder}</p>
              <p className="text-[11px] text-muted-foreground">{order.pickup} → {order.dropoff}</p>
            </div>
          </div>
        ), { duration: 5000 });
      }
    });
    return off;
  }, [profile?.isOnline, t.newOrder]);

  const toggleOnline = async (online: boolean) => {
    try {
      const p = await api.driverStatus(online);
      setProfile(p);
      toast.success(online ? (isAr ? 'أنت الآن متصل' : 'En ligne') : (isAr ? 'أنت غير متصل' : 'Hors ligne'));
    } catch {
      toast.error(isAr ? 'فشل' : 'Échec');
    }
  };

  const handleAccept = async (order: Order) => {
    setActing(order.id);
    try {
      const updated = await api.acceptOrder(order.id);
      // realtime emit handled by polling; the service fans out order:status
      toast.success(isAr ? 'تم قبول الطلب!' : 'Commande acceptée!');
      setIncoming((prev) => prev.filter((o) => o.id !== order.id));
      setActiveOrderId(updated.id);
      setDriverTab('trips');
    } catch {
      toast.error(isAr ? 'فشل القبول' : 'Échec');
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (order: Order) => {
    setActing(order.id);
    try {
      await api.rejectOrder(order.id);
      setIncoming((prev) => prev.filter((o) => o.id !== order.id));
      toast.success(isAr ? 'تم الرفض' : 'Refusé');
    } catch {
      toast.error(isAr ? 'فشل' : 'Échec');
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {/* Online toggle skeleton */}
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-2 w-24" />
            </div>
          </div>
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
        {/* Incoming requests skeleton (3 cards) */}
        <ListSkeleton count={3} />
      </div>
    );
  }

  const online = profile?.isOnline ?? false;

  return (
    <div className="space-y-4">
      {/* Status hero */}
      <Card className={cn('overflow-hidden p-0 transition', online ? 'ring-2 ring-emerald-500/30' : '')}>
        <div className={cn('p-4 text-primary-foreground', online ? 'bg-gradient-to-br from-emerald-600 to-emerald-700' : 'bg-gradient-to-br from-slate-600 to-slate-700')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                <Bike size={24} />
                {online && <span className="absolute -end-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-300 animate-pulse" />}
              </div>
              <div>
                <p className="text-base font-bold">{user?.name}</p>
                <p className="text-xs text-primary-foreground/80">
                  {profile?.vehicleRegistration
                    ? `${profile.vehicleRegistration.numeroImmatriculation} · ${profile.vehicleRegistration.marque}`
                    : '-'}
                </p>
                <p className="mt-0.5 text-[11px] font-bold">⭐ {profile?.rating} · {profile?.totalTrips} {t.trips}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', online ? 'bg-white/25' : 'bg-white/15')}>
                {online ? t.online : t.offline}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 p-3.5">
          <div className="flex items-center gap-2">
            {online ? <Wifi size={16} className="text-emerald-500" /> : <WifiOff size={16} className="text-muted-foreground" />}
            <span className="text-xs font-semibold text-foreground">
              {online ? (isAr ? 'تستقبل الطلبات الآن' : t.goOnline) : t.goOnline}
            </span>
          </div>
          <Switch checked={online} onCheckedChange={toggleOnline} />
        </div>
      </Card>

      {/* Incoming requests */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            {online ? <Bell size={15} className="text-primary" /> : <BellOff size={15} className="text-muted-foreground" />}
            {t.incomingRequests}
          </h2>
          {incoming.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              {incoming.length}
            </span>
          )}
        </div>

        {!online ? (
          <Card className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <WifiOff size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">{t.goOnline}</p>
          </Card>
        ) : incoming.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <span className="absolute h-14 w-14 rounded-full bg-primary/15 pulse-ring" />
              <Zap size={22} className="text-primary" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">{t.noIncoming}</p>
            <p className="text-[11px] text-muted-foreground">{isAr ? 'سنخبرك فور وصول طلب جديد' : 'Nouvelle demande bientôt'}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {incoming.map((o) => (
              <Card key={o.id} className="overflow-hidden p-0 ring-2 ring-primary/20">
                <div className="flex items-center justify-between bg-primary/5 p-2.5">
                  <span className="font-mono text-xs font-bold text-primary">{o.code}</span>
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                    <Zap size={11} /> {isAr ? 'طلب جديد' : 'Nouveau'}
                  </span>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <CargoIcon cargo={o.cargoType} size={20} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin size={11} className="text-primary" />
                        <span className="truncate">{o.pickup}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Flag size={11} className="text-[#FF7A00]" />
                        <span className="truncate">{o.dropoff}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                    <MiniStat icon={<Navigation size={11} />} value={`${o.distance} ${t.km}`} />
                    <MiniStat icon={<Scale size={11} />} value={`${o.weight} ${t.kg}`} />
                    <MiniStat icon={<Package size={11} />} value={(t.cargo as Record<string, string>)[o.cargoType]} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2">
                    <span className="text-xs font-semibold text-muted-foreground">{t.estimate}</span>
                    <span className="text-lg font-black text-primary">{formatDzd(o.price)} {t.dzd}</span>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      onClick={() => handleAccept(o)}
                      disabled={acting === o.id}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Check size={16} className="me-1.5" /> {t.accept}
                    </Button>
                    <Button
                      onClick={() => handleReject(o)}
                      disabled={acting === o.id}
                      variant="outline"
                      className="flex-1 border-destructive text-destructive"
                    >
                      <X size={16} className="me-1.5" /> {t.reject}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-center gap-1 rounded-lg bg-muted px-1.5 py-1 text-[11px] font-semibold text-muted-foreground">
      {icon}
      <span className="truncate">{value}</span>
    </div>
  );
}
