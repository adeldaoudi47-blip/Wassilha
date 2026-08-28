'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Bike, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type VehicleRegistration = {
  id: string;
  numeroImmatriculation: string;
  typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
  nom: string | null;
  prenom: string | null;
  raisonSociale: string | null;
  marque: string;
  type: string | null;
  anneePremiereMiseCirculation: number;
};

type Application = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  applicationStatus: 'pending' | 'rejected';
  appliedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  vehicleRegistration: VehicleRegistration | null;
};

export function AdminDriverApplications() {
  const { t, isAr } = useT();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.driverApplications()
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
      await api.approveDriver(id);
      toast.success(t.saved);
      load();
    } catch (e) {
      toast.error('Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusy(id);
    try {
      await api.rejectDriver(id);
      toast.success('OK');
      load();
    } catch (e) {
      toast.error('Reject failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading && apps.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
          <ShieldCheck size={18} className="text-amber-600" />
          {t.driverApplications}
        </h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {apps.filter((a) => a.applicationStatus === 'pending').length} {t.applicationPending}
        </span>
      </div>

      {apps.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <CheckCircle2 size={32} className="text-emerald-500" />
          <p className="text-sm font-bold text-foreground">{t.noApplications}</p>
        </Card>
      ) : (
        apps.map((a) => (
          <Card
            key={a.id}
            className={cn(
              'p-4',
              a.applicationStatus === 'rejected' && 'opacity-70'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bike size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{a.name}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground" dir="ltr">
                  <Phone size={11} /> {a.phone}
                </p>
                {a.vehicleRegistration ? (
                  <div className="mt-2 space-y-0.5 rounded-lg bg-muted/40 p-2 text-[11px]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                      {isAr ? 'البطاقة الرمادية' : 'Carte grise'}
                    </p>
                    <p className="font-semibold text-foreground" dir="ltr">
                      {a.vehicleRegistration.numeroImmatriculation}
                    </p>
                    <p className="text-muted-foreground">
                      {a.vehicleRegistration.marque}
                      {a.vehicleRegistration.type
                        ? ` · ${a.vehicleRegistration.type}`
                        : ''}
                      {' · '}
                      {a.vehicleRegistration.anneePremiereMiseCirculation}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.vehicleRegistration.typeProprietaire === 'PERSONNE_PHYSIQUE'
                        ? `${a.vehicleRegistration.prenom ?? ''} ${a.vehicleRegistration.nom ?? ''}`.trim() ||
                          (isAr ? 'مالك' : 'Proprietaire')
                        : a.vehicleRegistration.raisonSociale ||
                          (isAr ? 'شركة' : 'Societe')}
                    </p>
                  </div>
                ) : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {a.appliedAt
                    ? new Date(a.appliedAt).toLocaleString()
                    : new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black',
                  a.applicationStatus === 'pending'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                )}
              >
                {a.applicationStatus === 'pending'
                  ? t.applicationPending
                  : t.applicationRejected}
              </span>
            </div>

            {a.applicationStatus === 'pending' ? (
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => handleApprove(a.id)}
                  disabled={busy === a.id}
                  className="h-9 flex-1 rounded-xl bg-emerald-600 text-xs font-bold hover:bg-emerald-700"
                >
                  <CheckCircle2 size={14} className="me-1" />
                  {t.approve}
                </Button>
                <Button
                  onClick={() => handleReject(a.id)}
                  disabled={busy === a.id}
                  variant="outline"
                  className="h-9 flex-1 rounded-xl border-red-300 text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                >
                  <XCircle size={14} className="me-1" />
                  {t.reject}
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
