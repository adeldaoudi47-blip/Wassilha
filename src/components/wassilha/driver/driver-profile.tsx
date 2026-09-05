'use client';

import { Phone, Bike, Star, MapPin, ShieldCheck, BadgeCheck, LogOut, Pencil, Loader2 } from 'lucide-react';
import { useT } from '../use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDzd } from '@/lib/wassilha-data';
import type { DriverProfile } from '@/lib/types';

export function DriverProfile() {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-foreground">
          {t.vehicleData}
        </h2>
        {profile?.vehicleRegistration && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="h-8 gap-1.5 text-primary hover:text-primary"
          >
            <Pencil size={14} />
            {t.editVehicle}
          </Button>
        )}
      </div>
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

      {profile?.vehicleRegistration && (
        <VehicleEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          vehicle={profile.vehicleRegistration}
          onSaved={(updated) => {
            setProfile({ ...profile, vehicleRegistration: updated });
          }}
        />
      )}
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

// Energie allow-list mirrored from the API. Kept here so the <select>
// only offers valid values, and the server-side allow-list still has
// the final say.
const ENERGIE_OPTIONS = [
  'Benzine',
  'Diesel',
  'GPL',
  'Electrique',
  'Hybride',
] as const;

// Dialog that lets the driver edit their carte-grise fields. Pre-filled
// from the current `vehicle` prop; on submit it calls
// `api.updateVehicleRegistration` and bubbles the updated record back
// via `onSaved`. Server-side error codes (e.g. duplicate plate) are
// surfaced as a toast.
function VehicleEditDialog({
  open,
  onOpenChange,
  vehicle,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicle: DriverProfile['vehicleRegistration'] & object;
  onSaved: (updated: NonNullable<DriverProfile['vehicleRegistration']>) => void;
}) {
  const { t, isAr } = useT();
  // Local form state, seeded from props on mount + whenever the dialog
  // re-opens with fresh data. We intentionally don't keep the seed
  // updated while the dialog is open so the user can type freely.
  const [numeroImmatriculation, setNumeroImmatriculation] = useState(
    vehicle.numeroImmatriculation
  );
  const [marque, setMarque] = useState(vehicle.marque);
  const [type, setType] = useState(vehicle.type ?? '');
  const [annee, setAnnee] = useState(
    String(vehicle.anneePremiereMiseCirculation)
  );
  const [adresse, setAdresse] = useState('');
  // Optional fields live only on the full VR row — fetch them from
  // the current `vehicle` if present (we accept partial objects).
  const [ptac, setPtac] = useState('');
  const [poidsAVide, setPoidsAVide] = useState('');
  const [energie, setEnergie] = useState('');
  const [puissance, setPuissance] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed when opening with different data.
  useEffect(() => {
    if (!open) return;
    setNumeroImmatriculation(vehicle.numeroImmatriculation);
    setMarque(vehicle.marque);
    setType(vehicle.type ?? '');
    setAnnee(String(vehicle.anneePremiereMiseCirculation));
    // Extended fields may not be on the type used by the GET endpoint;
    // we read them defensively through any-cast.
    const v = vehicle as unknown as Record<string, unknown>;
    setAdresse(typeof v.adresse === 'string' ? (v.adresse as string) : '');
    setPtac(typeof v.ptac === 'string' ? (v.ptac as string) : '');
    setPoidsAVide(
      typeof v.poidsAVide === 'string' ? (v.poidsAVide as string) : ''
    );
    setEnergie(typeof v.energie === 'string' ? (v.energie as string) : '');
    setPuissance(
      typeof v.puissance === 'string' ? (v.puissance as string) : ''
    );
  }, [open, vehicle]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Client-side sanity check; server still has the final say.
    const yearNum = Number(annee);
    if (!Number.isInteger(yearNum)) {
      toast.error(t.updateFailed);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateVehicleRegistration({
        numeroImmatriculation: numeroImmatriculation.trim(),
        marque: marque.trim(),
        type: type.trim() || null,
        anneePremiereMiseCirculation: yearNum,
        adresse: adresse.trim() || null,
        ptac: ptac.trim() || null,
        poidsAVide: poidsAVide.trim() || null,
        energie: energie.trim() || null,
        puissance: puissance.trim() || null,
      });
      onSaved(updated);
      toast.success(t.vehicleUpdated);
      onOpenChange(false);
    } catch (err) {
      // Show the server-side error code (e.g. "numeroImmatriculationAlreadyUsed")
      // so the driver knows what to fix.
      const msg = err instanceof Error ? err.message : t.updateFailed;
      toast.error(msg || t.updateFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.editVehicle}</DialogTitle>
          <DialogDescription>
            {isAr
              ? 'يمكنك تحديث معلومات مركبتك في أي وقت.'
              : 'Vous pouvez mettre à jour les informations de votre véhicule à tout moment.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-plate">{t.registrationNumber}</Label>
            <Input
              id="vehicle-plate"
              value={numeroImmatriculation}
              onChange={(e) => setNumeroImmatriculation(e.target.value)}
              required
              maxLength={64}
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-brand">{t.brand}</Label>
              <Input
                id="vehicle-brand"
                value={marque}
                onChange={(e) => setMarque(e.target.value)}
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-type">
                {isAr ? 'نوع المركبة' : 'Type'}
              </Label>
              <Input
                id="vehicle-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                maxLength={64}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-year">
                {isAr ? 'سنة أول وضع للسير' : 'Année de mise en circulation'}
              </Label>
              <Input
                id="vehicle-year"
                type="number"
                value={annee}
                onChange={(e) => setAnnee(e.target.value)}
                required
                min={1950}
                max={new Date().getFullYear() + 1}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-energie">{t.energy}</Label>
              <select
                id="vehicle-energie"
                value={energie}
                onChange={(e) => setEnergie(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {ENERGIE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-adresse">{t.address}</Label>
            <Input
              id="vehicle-adresse"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              maxLength={128}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-ptac">{t.ptac}</Label>
              <Input
                id="vehicle-ptac"
                value={ptac}
                onChange={(e) => setPtac(e.target.value)}
                maxLength={128}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-poids">{t.emptyWeight}</Label>
              <Input
                id="vehicle-poids"
                value={poidsAVide}
                onChange={(e) => setPoidsAVide(e.target.value)}
                maxLength={128}
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-puissance">{t.power}</Label>
            <Input
              id="vehicle-puissance"
              value={puissance}
              onChange={(e) => setPuissance(e.target.value)}
              maxLength={128}
              dir="ltr"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={14} className="me-2 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
