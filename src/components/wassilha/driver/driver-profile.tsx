'use client';

import { Phone, Bike, Star, MapPin, ShieldCheck, BadgeCheck, LogOut } from 'lucide-react';
import { useT } from '../use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDzd } from '@/lib/wassilha-data';
import type { DriverProfile } from '@/lib/types';

export function DriverProfile() {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [profile, setProfile] = useState<DriverProfile | null>(null);

  useEffect(() => {
    api.driverProfile().then(setProfile).catch(() => {});
  }, []);

  const toggleOnline = async (online: boolean) => {
    try {
      const p = await api.driverStatus(online);
      setProfile(p);
    } catch { /* ignore */ }
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-primary to-brand-dark p-5 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black backdrop-blur">
              {user?.name.charAt(0)}
              <span className={`absolute -bottom-0.5 -end-0.5 h-4 w-4 rounded-full border-2 border-card ${profile?.isOnline ? 'bg-emerald-400' : 'bg-slate-400'}`} />
            </div>
            <div>
              <p className="text-lg font-bold">{user?.name}</p>
              <p className="flex items-center gap-1.5 text-sm text-primary-foreground/80" dir="ltr">
                <Phone size={12} /> +213 {user?.phone}
              </p>
              <div className="mt-1 flex gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold backdrop-blur">
                  <Bike size={10} /> {t.driver}
                </span>
                {profile?.isVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-100 backdrop-blur">
                    <BadgeCheck size={10} /> {t.verified}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-x-reverse divide-border">
          <Stat label={t.trips} value={String(profile?.totalTrips ?? 0)} />
          <Stat label={t.rating} value={(profile?.rating ?? 5).toFixed(1)} icon={<Star size={11} className="text-amber-400" fill="currentColor" />} />
          <Stat label={t.earnings} value={formatDzd(profile?.totalEarnings ?? 0)} />
        </div>
        {profile ? (
          <p className="px-4 pb-3 text-center text-[11px] font-semibold text-muted-foreground">
            <Star size={11} className="me-1 inline-block align-[-2px] text-amber-400" fill="currentColor" />
            {(profile.rating ?? 5).toFixed(1)} · {profile.totalTrips} {t.ratings}
          </p>
        ) : null}
      </Card>

      {/* Online toggle */}
      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
          {profile?.isOnline ? <ShieldCheck size={18} className="text-emerald-500" /> : <Bike size={18} className="text-muted-foreground" />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">{profile?.isOnline ? t.online : t.offline}</p>
          <p className="text-xs text-muted-foreground">{t.goOnline}</p>
        </div>
        <Switch checked={profile?.isOnline ?? false} onCheckedChange={toggleOnline} />
      </Card>

      {/* Vehicle info (carte grise) */}
      <Card className="divide-y divide-border p-0">
        <Row
          icon={<Bike size={16} className="text-primary" />}
          label={isAr ? 'رقم التسجيل' : "Numero d'immatriculation"}
          value={profile?.vehicleRegistration?.numeroImmatriculation ?? '-'}
        />
        <Row
          icon={<span className="text-base">🏷️</span>}
          label={isAr ? 'الماركة' : 'Marque'}
          value={profile?.vehicleRegistration?.marque ?? '-'}
        />
        <Row
          icon={<span className="text-base">🔢</span>}
          label={isAr ? 'نوع المركبة' : 'Type'}
          value={profile?.vehicleRegistration?.type ?? '-'}
        />
        <Row
          icon={<span className="text-base">📅</span>}
          label={isAr ? 'سنة الضخ' : 'Mise en circulation'}
          value={
            profile?.vehicleRegistration?.anneePremiereMiseCirculation
              ? String(profile.vehicleRegistration.anneePremiereMiseCirculation)
              : '-'
          }
        />
        <Row
          icon={<MapPin size={16} className="text-sky-500" />}
          label={t.location}
          value={t.location}
        />
      </Card>

      <Button onClick={handleLogout} variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/5">
        <LogOut size={16} className="me-2" /> {t.logout}
      </Button>

      <p className="text-center text-[10px] text-muted-foreground">
        {t.appName} v1.0.0 · {t.location} · © 2026
      </p>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="p-3 text-center">
      <p className="flex items-center justify-center gap-0.5 text-lg font-black text-primary">
        {icon}{value}
      </p>
      <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="ms-auto text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}
