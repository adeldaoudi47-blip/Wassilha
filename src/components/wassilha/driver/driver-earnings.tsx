'use client';

import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, Star, Bike, Calendar, ArrowUpRight } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { CargoIcon } from '../cargo-icon';
import { formatDzd } from '@/lib/wassilha-data';
import {
  BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

interface EarningsData {
  total: number;
  thisWeek: number;
  trips: number;
  rating: number;
  recent: { id: string; code: string; price: number; cargoType: any; createdAt: string; status: string }[];
  weekly: { day: string; earnings: number }[];
}

export function DriverEarnings() {
  const { t, isAr } = useT();
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.driverEarnings().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const maxEarning = Math.max(...data.weekly.map((w) => w.earnings), 1);

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-lg font-black text-foreground">{t.earnings}</h2>

      {/* Total earnings hero */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-primary via-brand-dark to-emerald-800 p-5 text-primary-foreground">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Wallet size={20} />
              </div>
              <span className="text-sm font-semibold text-primary-foreground/90">{t.earningsTotal}</span>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
              <ArrowUpRight size={11} /> +12%
            </span>
          </div>
          <p className="mt-3 text-4xl font-black tracking-tight">
            {formatDzd(data.total)} <span className="text-lg font-bold text-primary-foreground/70">{t.dzd}</span>
          </p>
          <div className="mt-3 flex items-center gap-4 text-xs text-primary-foreground/80">
            <span className="flex items-center gap-1">
              <Calendar size={12} /> {t.thisWeek}: <strong className="text-primary-foreground">{formatDzd(data.thisWeek)} {t.dzd}</strong>
            </span>
          </div>
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={<Bike size={18} className="text-sky-500" />} value={String(data.trips)} label={t.trips} />
        <StatCard icon={<Star size={18} className="text-amber-500" />} value={data.rating.toFixed(1)} label={t.rating} />
        <StatCard
          icon={<TrendingUp size={18} className="text-emerald-500" />}
          value={data.trips > 0 ? formatDzd(Math.round(data.total / data.trips)) : '0'}
          label={isAr ? 'متوسط/رحلة' : 'Moy/course'}
        />
      </div>

      {/* Weekly chart */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{t.weeklyRevenue}</h3>
          <span className="text-xs text-muted-foreground">{formatDzd(data.thisWeek)} {t.dzd}</span>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.weekly} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: 'currentColor' }}
                axisLine={false}
                tickLine={false}
                className="text-muted-foreground"
              />
              <Tooltip
                cursor={{ fill: 'rgba(14,107,94,0.08)' }}
                contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                formatter={(v: number) => [`${formatDzd(v)} ${t.dzd}`, t.earnings]}
              />
              <Bar dataKey="earnings" radius={[6, 6, 0, 0]}>
                {data.weekly.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.earnings === maxEarning ? '#FF7A00' : '#0E6B5E'}
                    opacity={entry.earnings === 0 ? 0.25 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Recent trips */}
      <div>
        <h3 className="mb-2 px-1 text-sm font-bold text-foreground">{isAr ? 'أحدث الرحلات' : 'Courses récentes'}</h3>
        {data.recent.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t.noTrips}</Card>
        ) : (
          <div className="space-y-2">
            {data.recent.slice(0, 6).map((o) => (
              <Card key={o.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <CargoIcon cargo={o.cargoType} size={16} />
                </div>
                <div className="flex-1">
                  <p className="font-mono text-xs font-bold text-foreground">{o.code}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(o.createdAt).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
                <span className={cn('text-sm font-black', o.status === 'delivered' ? 'text-emerald-600' : 'text-amber-600')}>
                  {o.status === 'delivered' ? '+' : ''}{formatDzd(o.price)}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card className="flex flex-col items-center gap-1 p-3 text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <p className="text-base font-black text-foreground">{value}</p>
      <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
    </Card>
  );
}
