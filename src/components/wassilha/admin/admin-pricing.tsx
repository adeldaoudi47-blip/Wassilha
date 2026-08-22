'use client';

import { useEffect, useState } from 'react';
import { Tags, Save, TrendingUp, Calculator } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CARGO_TYPES } from '@/lib/wassilha-data';
import { CargoIcon } from '../cargo-icon';
import { cn } from '@/lib/utils';
import type { CargoKey, PricingConfig } from '@/lib/types';

export function AdminPricing() {
  const { t, isAr } = useT();
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getPricing().then(setPricing).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!pricing) return;
    setSaving(true);
    try {
      await api.updatePricing({
        basePrice: pricing.basePrice,
        perKm: pricing.perKm,
        multipliers: pricing.multipliers,
      });
      toast.success(t.saved);
    } catch {
      toast.error(isAr ? 'فشل الحفظ' : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !pricing) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const updateMult = (k: CargoKey, v: number) => {
    setPricing({ ...pricing, multipliers: { ...pricing.multipliers, [k]: v } });
  };

  // Example calc
  const examplePrice = Math.round((pricing.basePrice + 3.5 * pricing.perKm) * pricing.multipliers.furniture);

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-lg font-black text-foreground">{t.managePricing}</h2>

      {/* Base pricing */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Calculator size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{t.priceConfig}</h3>
            <p className="text-[11px] text-muted-foreground">{isAr ? 'الأسعار بالدينار الجزائري' : 'Prix en Dinar Algérien'}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">{t.basePrice} ({t.dzd})</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                value={pricing.basePrice}
                onChange={(e) => setPricing({ ...pricing, basePrice: parseInt(e.target.value) || 0 })}
                className="h-11 text-lg font-bold"
                dir="ltr"
              />
              <span className="text-sm font-bold text-muted-foreground">{t.dzd}</span>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">{t.perKm} ({t.dzd})</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                value={pricing.perKm}
                onChange={(e) => setPricing({ ...pricing, perKm: parseInt(e.target.value) || 0 })}
                className="h-11 text-lg font-bold"
                dir="ltr"
              />
              <span className="text-sm font-bold text-muted-foreground">{t.dzd}/{t.km}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Cargo multipliers */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-bold text-foreground">{t.cargoMultiplier}</h3>
        <div className="space-y-2">
          {CARGO_TYPES.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: c.color + '15' }}>
                <CargoIcon cargo={c.key} size={16} />
              </div>
              <span className="flex-1 text-sm font-semibold text-foreground">
                {(t.cargo as Record<string, string>)[c.key]}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-muted-foreground">×</span>
                <Input
                  type="number"
                  step="0.1"
                  value={pricing.multipliers[c.key]}
                  onChange={(e) => updateMult(c.key, parseFloat(e.target.value) || 1)}
                  className="h-9 w-16 text-center text-sm font-bold"
                  dir="ltr"
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Live example */}
      <Card className="bg-gradient-to-br from-primary/5 to-transparent p-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <span className="text-xs font-bold text-muted-foreground">{isAr ? 'مثال: أثاث، 3.5 كم' : 'Exemple: meubles, 3.5 km'}</span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <span className="text-xs text-muted-foreground">
            {pricing.basePrice} + (3.5 × {pricing.perKm}) × {pricing.multipliers.furniture}
          </span>
          <p className="text-2xl font-black text-primary">
            {Math.round((pricing.basePrice + 3.5 * pricing.perKm) * pricing.multipliers.furniture).toLocaleString('fr-DZ')} {t.dzd}
          </p>
        </div>
      </Card>

      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full bg-primary">
        <Save size={18} className="me-2" />
        {saving ? '...' : t.save}
      </Button>
    </div>
  );
}
