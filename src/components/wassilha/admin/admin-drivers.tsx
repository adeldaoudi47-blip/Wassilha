'use client';

import { useEffect, useState } from 'react';
import { Bike, Plus, Star, Phone, BadgeCheck, ShieldCheck, ShieldOff } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDzd } from '@/lib/wassilha-data';
import { cn } from '@/lib/utils';
import type { DriverProfile } from '@/lib/types';

export function AdminDrivers() {
  const { t, isAr } = useT();
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', vehicleType: 'Triporteur 125cc', vehicleColor: 'أزرق' });
  const [saving, setSaving] = useState(false);

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
      setForm({ name: '', phone: '', vehicleType: 'Triporteur 125cc', vehicleColor: 'أزرق' });
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
                  </div>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
                    <Phone size={10} /> +213 {d.user.phone}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Star size={9} className="text-amber-400" fill="currentColor" /> {d.rating}</span>
                    <span>·</span>
                    <span>{d.totalTrips} {t.trips}</span>
                    <span>·</span>
                    <span className="truncate">{d.vehicleColor}</span>
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
    </div>
  );
}
