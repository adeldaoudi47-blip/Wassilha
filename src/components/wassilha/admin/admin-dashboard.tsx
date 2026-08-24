'use client';

import { useEffect, useState } from 'react';
import {
  Package, Bike, DollarSign, Clock, TrendingUp, Users, CheckCircle2, Activity,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { formatDzd } from '@/lib/wassilha-data';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { AdminStats } from '@/lib/types';

const PIE_COLORS = ['#0E6B5E', '#FF7A00', '#0EA5E9', '#8B5CF6', '#10B981', '#EC4899', '#F59E0B', '#64748B'];
const STATUS_COLORS: Record<string, string> = {
  searching: '#F59E0B', accepted: '#0EA5E9', picked: '#8B5CF6', delivered: '#10B981', cancelled: '#EF4444',
};

export function AdminDashboard() {
  const { t, isAr } = useT();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
    const id = setInterval(() => api.adminStats().then(setStats).catch(() => {}), 8000);
    return () => clearInterval(id);
  }, []);

  if (loading || !stats) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-black text-foreground">{t.dashboard}</h2>
        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> {t.realtimeActive}
        </span>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi icon={<Package size={18} />} color="bg-primary/10 text-primary" label={t.totalOrders} value={String(stats.totalOrders)} />
        <Kpi icon={<DollarSign size={18} />} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" label={t.revenue} value={`${formatDzd(stats.revenue)}`} suffix={t.dzd} />
        <Kpi icon={<Bike size={18} />} color="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" label={t.activeDrivers} value={`${stats.activeDrivers}/${stats.totalDrivers}`} />
        <Kpi icon={<Clock size={18} />} color="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" label={t.avgDelivery} value={`${stats.avgDelivery}`} suffix={t.min} />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-2">
        <MiniKpi icon={<Clock size={14} className="text-amber-500" />} value={String(stats.pendingOrders)} label={t.pendingOrders} />
        <MiniKpi icon={<CheckCircle2 size={14} className="text-emerald-500" />} value={String(stats.deliveredOrders)} label={t.deliveredOrders} />
        <MiniKpi icon={<Activity size={14} className="text-sky-500" />} value={String(stats.todayOrders)} label={t.todayOrders} />
      </div>

      {/* Revenue chart */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <TrendingUp size={15} className="text-primary" /> {t.weeklyRevenue}
          </h3>
          <span className="text-xs font-bold text-primary">{formatDzd(stats.revenue)} {t.dzd}</span>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.revenueByDay} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0E6B5E" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0E6B5E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'currentColor' }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                formatter={(v: number) => [`${formatDzd(v)} ${t.dzd}`, t.revenue]}
              />
              <Area type="monotone" dataKey="revenue" stroke="#0E6B5E" strokeWidth={2.5} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Two-column: status + cargo */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Orders by status */}
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-bold text-foreground">{t.ordersByStatus}</h3>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.ordersByStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={45}
                  paddingAngle={2}
                >
                  {stats.ordersByStatus.map((entry, i) => (
                    <Cell key={i} fill={STATUS_COLORS[entry.status] ?? '#94A3B8'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 11 }}
                  formatter={(v: number, _n: string, p: any) => [v, (t.status as Record<string,string>)[p.payload.status] ?? p.payload.status]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 space-y-0.5">
            {stats.ordersByStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-1.5 text-[10px]">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} />
                <span className="flex-1 text-muted-foreground">{(t.status as Record<string,string>)[s.status] ?? s.status}</span>
                <span className="font-bold text-foreground">{s.count}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Cargo breakdown */}
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-bold text-foreground">{t.cargoDistribution}</h3>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.cargoBreakdown} layout="vertical" margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="cargo" hide />
                <Tooltip
                  cursor={{ fill: 'rgba(14,107,94,0.08)' }}
                  contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 11 }}
                  formatter={(v: number, _n: string, p: any) => [v, (t.cargo as Record<string,string>)[p.payload.cargo] ?? p.payload.cargo]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {stats.cargoBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {stats.cargoBreakdown.slice(0, 4).map((c, i) => (
              <span key={c.cargo} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                {(t.cargo as Record<string,string>)[c.cargo] ?? c.cargo}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Fleet summary */}
      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Users size={20} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">{t.fleet}</p>
          <p className="text-xs text-muted-foreground">{stats.totalDrivers} {t.totalDrivers} · {stats.activeDrivers} {t.onlineDrivers}</p>
        </div>
        <div className="flex gap-1">
          {[...Array(stats.totalDrivers)].map((_, i) => (
            <Bike
              key={i}
              size={16}
              className={cn(i < stats.activeDrivers ? 'text-emerald-500' : 'text-muted-foreground/40')}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ icon, color, label, value, suffix }: { icon: React.ReactNode; color: string; label: string; value: string; suffix?: string }) {
  return (
    <Card className="p-3.5">
      <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-lg', color)}>{icon}</div>
      <p className="text-xl font-black text-foreground">{value}<span className="ms-0.5 text-xs font-bold text-muted-foreground">{suffix}</span></p>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
    </Card>
  );
}

function MiniKpi({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card className="flex flex-col items-center gap-0.5 p-2.5 text-center">
      {icon}
      <p className="text-base font-black text-foreground">{value}</p>
      <p className="text-[9px] font-semibold leading-tight text-muted-foreground">{label}</p>
    </Card>
  );
}
