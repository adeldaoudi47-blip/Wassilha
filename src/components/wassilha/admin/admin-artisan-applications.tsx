'use client';

import { useEffect, useState } from 'react';
import { Hammer, CheckCircle2, XCircle, Phone, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ListSkeleton } from '../skeleton';
import type { CraftArtisanApplication } from '@/lib/types';

// HIRFA (P4): admin review queue for artisan store applications. Mirrors
// the driver applications screen: 10s polling, pending-first ordering,
// approve/reject actions guarded server-side by the privileged admin gate
// (requirePrivilegedAdmin) - hiding the buttons is never the security.
export function AdminArtisanApplications() {
  const { t, isAr } = useT();
  const [apps, setApps] = useState<CraftArtisanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getArtisanApplications()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const handleApprove = async (id: string) => {
    setBusy(id);
    try {
      await api.approveArtisan(id);
      toast.success(t.artisanApproved);
      load();
    } catch {
      toast.error(isAr ? 'فشل تنفيذ العملية' : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusy(id);
    try {
      await api.rejectArtisan(id);
      toast.success(t.artisanRejected);
      load();
    } catch {
      toast.error(isAr ? 'فشل تنفيذ العملية' : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading && apps.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
            <Hammer size={18} className="text-emerald-600" />
            {t.craftApplications}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            {t.loading}
          </span>
        </div>
        <ListSkeleton count={3} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
          <Hammer size={18} className="text-emerald-600" />
          {t.craftApplications}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {apps.length}
        </span>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <Hammer size={32} className="mx-auto text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">{t.noCraftApplications}</p>
        </div>
      ) : (
        apps.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                {a.displayName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-black text-foreground">{a.displayName}</p>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {a.user.name} · <span dir="ltr">{a.user.phone}</span>
                </p>
                {a.phone ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone size={11} />
                    <span dir="ltr">{a.phone}</span>
                  </p>
                ) : null}
                {a.area ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin size={11} />
                    {isAr ? a.area.nameAr : a.area.nameFr || a.area.nameAr}
                  </p>
                ) : null}
                {a.bioAr ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.bioAr}</p>
                ) : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {a.appliedAt ? new Date(a.appliedAt).toLocaleString() : new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black',
                  a.status === 'pending'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                )}
              >
                {a.status === 'pending' ? t.applicationPending : t.applicationRejected}
              </span>
            </div>

            {a.status === 'pending' ? (
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => handleApprove(a.id)}
                  disabled={busy === a.id}
                  className="h-9 flex-1 rounded-xl bg-emerald-600 text-xs font-bold hover:bg-emerald-700"
                >
                  <CheckCircle2 size={14} className="me-1" />
                  {t.approveArtisan}
                </Button>
                <Button
                  onClick={() => handleReject(a.id)}
                  disabled={busy === a.id}
                  variant="outline"
                  className="h-9 flex-1 rounded-xl border-red-300 text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                >
                  <XCircle size={14} className="me-1" />
                  {t.rejectArtisan}
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
