'use client';

import { useEffect, useState } from 'react';
import { Bike, Plus, Star, Phone, BadgeCheck, ShieldCheck, ShieldOff, Car, Package, Layers, Ban, Trash2 } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDzd } from '@/lib/wassilha-data';
import { cn } from '@/lib/utils';
import type { DriverProfile } from '@/lib/types';

// Local "what kind of destructive action is the admin about to take?"
// state. Keeping it in a single object means the confirm dialog is
// driven by one piece of state instead of two booleans + a target
// id (which is a classic source of stale-id bugs).
type ConfirmAction =
  | { kind: 'ban'; driver: DriverProfile }
  | { kind: 'delete'; driver: DriverProfile }
  | null;

export function AdminDrivers() {
  const { t, isAr } = useT();
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    vehicleType: 'Triporteur 125cc',
    vehicleColor: 'أزرق',
    numeroImmatriculation: '',
  });
  const [saving, setSaving] = useState(false);
  // The confirm dialog + which destructive action is queued. When
  // non-null, the AlertDialog is open and `confirmAction.kind` picks
  // the title/body/handler.
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  // Lock the confirm button while the network round-trip is in
  // flight so a double-click can't fire two DELETE calls.
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = () => {
    api.adminDrivers().then(setDrivers).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.phone) {
      toast.error(isAr ? 'أكمل البيانات' : 'Champs requis');
      return;
    }
    setSaving(true);
    try {
      await api.addDriver(form);
      toast.success(isAr ? 'تمت إضافة السائق' : 'Chauffeur ajouté');
      setAddOpen(false);
      setForm({
        name: '',
        phone: '',
        vehicleType: 'Triporteur 125cc',
        vehicleColor: 'أزرق',
        numeroImmatriculation: '',
      });
      load();
    } catch {
      toast.error(isAr ? 'فشل' : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const toggleVerified = async (d: DriverProfile) => {
    try {
      await api.toggleDriverVerified(d.id, !d.isVerified);
      load();
      toast.success(d.isVerified ? t.deactivate : t.activate);
    } catch { /* ignore */ }
  };

  // Ban = soft. The driver + vehicle rows are kept on disk so we
  // don't lose their order history. The server (PATCH .../reject)
  // flips accountStatus to 'rejected' and kills every active Session
  // so the next request from the driver hits 401.
  const handleBan = async (d: DriverProfile) => {
    setConfirmBusy(true);
    try {
      await api.banDriver(d.id);
      // Optimistic UI: drop the row immediately. The server has
      // already forced isOnline=false and the Session rows are gone,
      // so a stale card would just confuse the admin.
      setDrivers((prev) => prev.filter((x) => x.id !== d.id));
      toast.success(t.driverBanned);
      setConfirmAction(null);
    } catch (e) {
      // SECURITY: surface the server's own error key so the admin
      // can act on it (e.g. "notADriver" means the row is in a
      // weird state and the page should be reloaded).
      const key = (e as any)?.message || 'serverError';
      toast.error(key);
    } finally {
      setConfirmBusy(false);
    }
  };

  // Hard delete. The server refuses with `error: 'hasHistory'` if
  // the driver has Orders / Ratings — we surface the i18n'd message
  // and keep the row visible so the admin can fall back to the ban
  // flow.
  const handleDelete = async (d: DriverProfile) => {
    setConfirmBusy(true);
    try {
      await api.deleteDriver(d.id);
      setDrivers((prev) => prev.filter((x) => x.id !== d.id));
      toast.success(t.driverDeleted);
      setConfirmAction(null);
    } catch (e) {
      const key = (e as any)?.message || 'serverError';
      if (key === 'hasHistory') {
        toast.error(t.driverHasHistory);
      } else {
        toast.error(key);
      }
    } finally {
      setConfirmBusy(false);
    }
  };

  // Single entry-point for the AlertDialog. Picks the handler by
  // `kind` so the JSX is just one button + one onClick.
  const runConfirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.kind === 'ban') {
      await handleBan(confirmAction.driver);
    } else {
      await handleDelete(confirmAction.driver);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-black text-foreground">{t.manageDrivers}</h2>
        <Button onClick={() => setAddOpen(true)} size="sm" className="bg-primary">
          <Plus size={15} className="me-1" /> {t.addDriver}
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-2.5 text-center">
          <p className="text-lg font-black text-primary">{drivers.length}</p>
          <p className="text-[10px] font-semibold text-muted-foreground">{t.totalDrivers}</p>
        </Card>
        <Card className="p-2.5 text-center">
          <p className="text-lg font-black text-emerald-600">{drivers.filter((d) => d.isOnline).length}</p>
          <p className="text-[10px] font-semibold text-muted-foreground">{t.onlineDrivers}</p>
        </Card>
        <Card className="p-2.5 text-center">
          <p className="text-lg font-black text-amber-500">
            {drivers.length > 0 ? (drivers.reduce((s, d) => s + d.rating, 0) / drivers.length).toFixed(1) : '0'}
          </p>
          <p className="text-[10px] font-semibold text-muted-foreground">{t.avgRating}</p>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : drivers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t.noDriversFound}</Card>
      ) : (
        <div className="space-y-2">
          {drivers.map((d) => (
            <Card key={d.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                  {d.user.name.charAt(0)}
                  <span className={cn('absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-card', d.isOnline ? 'bg-emerald-500' : 'bg-slate-300')} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold text-foreground">{d.user.name}</p>
                    {d.isVerified ? (
                      <BadgeCheck size={13} className="shrink-0 text-emerald-500" />
                    ) : (
                      <ShieldOff size={13} className="shrink-0 text-amber-500" />
                    )}
                    {/* Driver service-type icon — the driver picked
                        CARGO / TAXI / BOTH at registration. The icon
                        matches the order fan-out in /api/orders, so
                        reviewers can spot a taxi-only driver at a
                        glance. Falls back to the Bike icon for legacy
                        rows whose serviceType column defaulted to
                        "CARGO" or is missing. */}
                    <DriverServiceIcon serviceType={d.serviceType} />
                  </div>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
                    <Phone size={10} /> +213 {d.user.phone}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Star size={9} className="text-amber-400" fill="currentColor" /> {d.rating}</span>
                    <span>·</span>
                    <span>{d.totalTrips} {t.trips}</span>
                    <span>·</span>
                    <span className="truncate">
                      {d.vehicleRegistration
                        ? `${d.vehicleRegistration.numeroImmatriculation} · ${d.vehicleRegistration.marque}`
                        : '-'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-black text-primary">{formatDzd(d.totalEarnings)}</span>
                  <span className="text-[9px] text-muted-foreground">{t.dzd}</span>
                  <Button
                    onClick={() => toggleVerified(d)}
                    size="sm"
                    variant={d.isVerified ? 'outline' : 'default'}
                    className={cn('h-6 px-2 text-[10px]', !d.isVerified && 'bg-primary')}
                  >
                    {d.isVerified ? t.deactivate : t.activate}
                  </Button>
                  {/* Moderation row. Two icon buttons: a yellow Ban
                      (soft) and a red Trash2 (hard delete). Each
                      opens a confirm dialog before firing. We render
                      them as small square buttons so they line up
                      with the activate/deactivate button above
                      without breaking the card's flex column. */}
                  <div className="mt-0.5 flex items-center gap-1">
                    <Button
                      onClick={() => setConfirmAction({ kind: 'ban', driver: d })}
                      size="sm"
                      variant="outline"
                      title={t.banDriver}
                      aria-label={t.banDriver}
                      className="h-6 w-6 p-0 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                    >
                      <Ban size={12} />
                    </Button>
                    <Button
                      onClick={() => setConfirmAction({ kind: 'delete', driver: d })}
                      size="sm"
                      variant="outline"
                      title={t.deleteDriver}
                      aria-label={t.deleteDriver}
                      className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add driver dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.addDriver}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.driverName}</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={isAr ? 'اسم السائق' : 'Nom'} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.driverPhone}</label>
              <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="06XX XXX XXX" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                {isAr ? 'رقم التسجيل' : "Numero d'immatriculation"}
                <span className="text-[10px] text-muted-foreground"> ({isAr ? 'اختياري - ينشأ تلقائياً' : 'optionnel - auto'})</span>
              </label>
              <Input
                dir="ltr"
                value={form.numeroImmatriculation}
                onChange={(e) => setForm({ ...form, numeroImmatriculation: e.target.value })}
                placeholder={isAr ? 'مثال: 12345-A-06' : 'ex: 12345-A-06'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.vehicleType}</label>
              <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Triporteur 125cc">Triporteur 125cc</SelectItem>
                  <SelectItem value="Triporteur 150cc">Triporteur 150cc</SelectItem>
                  <SelectItem value="Triporteur 200cc">Triporteur 200cc</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.vehicleColor}</label>
              <Select value={form.vehicleColor} onValueChange={(v) => setForm({ ...form, vehicleColor: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="أزرق">أزرق</SelectItem>
                  <SelectItem value="أبيض">أبيض</SelectItem>
                  <SelectItem value="أحمر">أحمر</SelectItem>
                  <SelectItem value="أخضر">أخضر</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleAdd} disabled={saving} className="bg-primary">
              {saving ? '...' : t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog for ban / hard-delete. The body text and the
          destructive button's colour swap on `confirmAction.kind` so
          we render one AlertDialog instead of two. The Cancel button
          resets `confirmAction` (and also clears `confirmBusy` if the
          user closed mid-flight). */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === 'delete' ? t.deleteDriver : t.banDriver}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === 'delete' ? t.confirmDeleteDriver : t.confirmBanDriver}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // The Radix AlertDialog auto-closes after the action
                // click; we want it to stay open while the network
                // call is in flight, so we preventDefault and close
                // it manually from the handler on success.
                e.preventDefault();
                runConfirm();
              }}
              disabled={confirmBusy}
              className={cn(
                confirmAction?.kind === 'delete'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              )}
            >
              {confirmAction?.kind === 'delete' ? t.deleteDriver : t.banDriver}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Tiny inline icon used next to the driver name in the admin list.
// Renders the lucide icon that matches `serviceType`:
//   "CARGO" → Package (box icon, primary green)
//   "TAXI"  → Car       (yellow accent, Yassir-style)
//   "BOTH"  → Layers    (overlapping squares, primary green)
// Anything else (undefined / null / unknown legacy value) falls back
// to a muted Bike so the row stays visually consistent. Hovering
// surfaces a localised title that explains the service.
function DriverServiceIcon({ serviceType }: { serviceType?: string | null }) {
  const st = (serviceType ?? 'CARGO').toUpperCase();
  if (st === 'TAXI') {
    return (
      <span
        title="Taxi"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300"
      >
        <Car size={10} />
      </span>
    );
  }
  if (st === 'BOTH') {
    return (
      <span
        title="Cargo + Taxi"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/15 text-primary"
      >
        <Layers size={10} />
      </span>
    );
  }
  // Default: CARGO (or unknown → fall back to Bike for visual continuity
  // with the rest of the admin list, which still uses Bike for legacy
  // drivers).
  return (
    <span
      title="Cargo"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/15 text-primary"
    >
      <Package size={10} />
    </span>
  );
}
