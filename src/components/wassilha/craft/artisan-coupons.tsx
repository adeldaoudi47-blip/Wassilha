'use client';

import { useEffect, useState } from 'react';
import { Ticket, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { CouponPublic, CouponType } from '@/lib/types';

// HIRFA Phase 3 — artisan-owned discount codes ("كوبونات الخصم").
//
// A coupon is scoped to ONE artisan (the create route attaches artisanId from
// the session, never from the body), lives in the artisan dashboard next to
// products/orders, and is the only thing that can discount an order.
//
// SECURITY: usedCount is never editable here — codes are created through the
// guarded POST and deleted by id through a guarded DELETE. Redemption happens
// atomically INSIDE the order transaction, so a coupon can never be spent
// from this screen.
export function ArtisanCoupons() {
  const { t, isAr } = useT();
  const [coupons, setCoupons] = useState<CouponPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CouponPublic | null>(null);
  // Create-form state (no inline editing: coupons are cheap to recreate, and
  // editing a live code's value mid-campaign is a footgun).
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    type: 'percent' as CouponType,
    value: '',
    minOrderAmount: '',
    usageLimit: '',
    expiresAt: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = () => {
    setLoading(true);
    api
      .listMyCoupons()
      .then(setCoupons)
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () =>
    setForm({ code: '', type: 'percent', value: '', minOrderAmount: '', usageLimit: '', expiresAt: '' });

  const handleCreate = async () => {
    const code = form.code.trim().toUpperCase();
    const value = Number(form.value);
    if (code.length < 2) {
      toast.error(isAr ? 'أدخل كوداً (حرفان على الأقل)' : 'Saisissez un code (2 caractères minimum)');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(isAr ? 'قيمة الخصم غير صالحة' : 'Valeur de réduction invalide');
      return;
    }
    setCreating(true);
    try {
      const created = await api.createCoupon({
        code,
        type: form.type,
        // A percent above 100 is meaningless; the server clamps it anyway.
        value: form.type === 'percent' ? Math.min(100, Math.round(value)) : Math.round(value),
        minOrderAmount: Number(form.minOrderAmount) || 0,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        // The API expects an ISO datetime; a date input gives a calendar day,
        // so end-of-day is attached to make "expires 2026-09-01" inclusive.
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
        isActive: true,
      });
      setCoupons((prev) => [created, ...prev]);
      resetForm();
      setShowForm(false);
      toast.success(t.couponCreated);
    } catch {
      toast.error(isAr ? 'تعذر إنشاء الكوبون' : 'Création impossible');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (c: CouponPublic) => {
    setConfirmDelete(null);
    setDeleting(c.id);
    try {
      await api.deleteCoupon(c.id);
      setCoupons((prev) => prev.filter((x) => x.id !== c.id));
      toast.success(t.couponDeleted);
    } catch {
      toast.error(isAr ? 'تعذر حذف الكوبون' : 'Suppression impossible');
    } finally {
      setDeleting(null);
    }
  };


  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
          <Ticket size={18} className="text-primary" />
          {t.manageCoupons}
        </h2>
        <Button
          onClick={() => {
            setShowForm((v) => !v);
            resetForm();
          }}
          variant="outline"
          className="gap-1.5 rounded-xl text-xs font-bold"
        >
          <Plus size={14} />
          {t.createCoupon}
        </Button>
      </div>

      {showForm && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.couponCode}</label>
            <Input
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              dir="ltr"
              maxLength={40}
              placeholder="WELCOME10"
              className="font-bold"
            />
            <p className="text-[10px] text-muted-foreground">{t.codeUppercaseHint}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">{t.couponType}</label>
              <Select value={form.type} onValueChange={(v) => set('type', v as CouponType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">{t.couponPercent}</SelectItem>
                  <SelectItem value="fixed">{t.couponFixed}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">{t.couponValue}</label>
              <Input
                value={form.value}
                onChange={(e) => set('value', e.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder={form.type === 'percent' ? '10' : '500'}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">{t.minOrderAmount}</label>
              <Input
                value={form.minOrderAmount}
                onChange={(e) => set('minOrderAmount', e.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">{t.usageLimit}</label>
              <Input
                value={form.usageLimit}
                onChange={(e) => set('usageLimit', e.target.value)}
                inputMode="numeric"
                dir="ltr"
                placeholder="∞"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.expiresAt}</label>
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              variant="outline"
              className="flex-1"
              disabled={creating}
            >
              {isAr ? 'إلغاء' : 'Annuler'}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {creating && <Loader2 size={14} className="me-1 animate-spin" />}
              {t.createCoupon}
            </Button>
          </div>
        </Card>
      )}

      {coupons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Ticket size={44} className="text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">{t.noCoupons}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => {
            // Expired/exhausted codes stay visible but flagged: the server
            // already refuses them at checkout, so keeping them is honest
            // history rather than a silent hole in the list.
            const expired = !!c.expiresAt && new Date(c.expiresAt) < new Date();
            const exhausted = c.usageLimit !== null && c.usedCount >= c.usageLimit;
            return (
              <Card key={c.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <code dir="ltr" className="text-base font-black text-primary">
                      {c.code}
                    </code>
                    <span
                      className={cn(
                        'ms-2 rounded-full px-2 py-0.5 text-[10px] font-black',
                        expired || exhausted || !c.isActive
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
                      )}
                    >
                      {!c.isActive
                        ? t.couponInactive
                        : expired
                          ? t.couponExpired
                          : exhausted
                            ? t.couponExhausted
                            : t.couponActive}
                    </span>
                  </div>
                  <button
                    onClick={() => setConfirmDelete(c)}
                    disabled={deleting === c.id}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    aria-label={t.deleteCouponConfirm}
                  >
                    {deleting === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">
                    {c.type === 'percent' ? `${c.value}%` : `${c.value} ${t.currencyDzd}`}
                  </span>
                  {c.minOrderAmount > 0 && (
                    <span>
                      {t.couponMinOrder}: {c.minOrderAmount} {t.currencyDzd}
                    </span>
                  )}
                  <span>
                    {t.usedCount}: {c.usedCount}
                    {c.usageLimit !== null ? ` / ${c.usageLimit}` : ''}
                  </span>
                  {c.expiresAt && (
                    <span>
                      {t.expiresAt}:{' '}
                      {new Date(c.expiresAt).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ')}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={t.deleteCouponConfirm}
        description={confirmDelete?.code ?? ''}
        confirmLabel={isAr ? 'حذف' : 'Supprimer'}
        destructive
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

