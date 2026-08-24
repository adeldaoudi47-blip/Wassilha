'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Minus, Plus, Calculator, Bike, ShieldCheck, Clock, CloudOff,
  MapPin, Flag, ChevronDown, Settings2, Check,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  CARGO_TYPES, GUERRARA_LOCATIONS, GUERRARA_COORDS, haversineKm, calcPrice, formatDzd,
} from '@/lib/wassilha-data';
import { emitOrderCreated } from '@/lib/realtime';
import { useNavStore } from '@/lib/store';
import { GuerraraMap } from '../guerrara-map';
import { CargoIcon } from '../cargo-icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CargoKey, PricingConfig } from '@/lib/types';

export function CustomerHome() {
  const { t, isAr, isRtl } = useT();
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);

  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [selectedCargo, setSelectedCargo] = useState<CargoKey>('parcel');
  const [pickupIdx, setPickupIdx] = useState(0);
  const [dropoffIdx, setDropoffIdx] = useState(1);
  const [weight, setWeight] = useState(20);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPricingSheet, setShowPricingSheet] = useState(false);

  useEffect(() => {
    api.getPricing().then(setPricing).catch(() => toast.error(isAr ? 'تعذر تحميل التسعير' : 'Tarifs indisponibles'));
  }, [isAr]);

  const distance = useMemo(() => {
    const a = GUERRARA_COORDS[pickupIdx] ?? { lat: 32.7833, lng: 3.7667 };
    const b = GUERRARA_COORDS[dropoffIdx] ?? { lat: 32.79, lng: 3.78 };
    return Math.max(0.8, haversineKm(a, b));
  }, [pickupIdx, dropoffIdx]);

  const estimatedPrice = useMemo(() => {
    if (!pricing) return 0;
    const mult = pricing.multipliers[selectedCargo] ?? 1;
    return calcPrice(pricing.basePrice, pricing.perKm, distance, mult);
  }, [pricing, selectedCargo, distance]);

  const handleRequest = async () => {
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        cargoType: selectedCargo,
        pickup: GUERRARA_LOCATIONS[pickupIdx],
        dropoff: GUERRARA_LOCATIONS[dropoffIdx],
        weight,
        distance,
        price: estimatedPrice,
        notes: notes || undefined,
        pickupLat: GUERRARA_COORDS[pickupIdx]?.lat,
        pickupLng: GUERRARA_COORDS[pickupIdx]?.lng,
        dropoffLat: GUERRARA_COORDS[dropoffIdx]?.lat,
        dropoffLng: GUERRARA_COORDS[dropoffIdx]?.lng,
      });
      emitOrderCreated(order);
      setActiveOrderId(order.id);
      setCustomerTab('track');
      toast.success(t.orderCreated);
    } catch {
      toast.error(isAr ? 'فشل إنشاء الطلب' : 'Échec');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Map preview */}
      <GuerraraMap
        pickupLabel={GUERRARA_LOCATIONS[pickupIdx]}
        dropoffLabel={GUERRARA_LOCATIONS[dropoffIdx]}
        height="h-52"
      />

      {/* Pickup / Dropoff */}
      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-border">
          <LocationRow
            icon={<MapPin size={16} className="text-primary" />}
            label={t.pickup}
            value={GUERRARA_LOCATIONS[pickupIdx]}
            options={GUERRARA_LOCATIONS}
            onSelect={(i) => setPickupIdx(i)}
            isRtl={isRtl}
          />
          <LocationRow
            icon={<Flag size={16} className="text-[#FF7A00]" />}
            label={t.dropoff}
            value={GUERRARA_LOCATIONS[dropoffIdx]}
            options={GUERRARA_LOCATIONS}
            onSelect={(i) => setDropoffIdx(i)}
            isRtl={isRtl}
          />
        </div>
      </Card>

      {/* Cargo types */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{t.cargoTypes}</h3>
          <span className="text-xs text-muted-foreground">{t.cargoTypesSub}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {CARGO_TYPES.map((cargo) => {
            const selected = selectedCargo === cargo.key;
            return (
              <button
                key={cargo.key}
                onClick={() => setSelectedCargo(cargo.key)}
                className={cn(
                  'relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 transition',
                  selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/30'
                )}
              >
                {selected && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white">
                    <Check size={9} />
                  </span>
                )}
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: selected ? '#0E6B5E' : cargo.color + '15' }}
                >
                  <CargoIcon cargo={cargo.key} size={18} className={selected ? '!text-white' : ''} />
                </div>
                <span className={cn('text-[10px] font-semibold leading-tight', selected ? 'text-primary' : 'text-muted-foreground')}>
                  {(t.cargo as Record<string, string>)[cargo.key]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Weight */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{t.weight}</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
            {weight} {t.kg}
          </span>
        </div>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeight((w) => Math.max(5, w - 10))}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-primary hover:bg-muted/70"
            >
              <Minus size={18} />
            </button>
            <div className="relative flex-1">
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (weight / 500) * 100)}%` }}
                />
              </div>
              <div
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow"
                style={{ insetInlineStart: `calc(${Math.min(100, (weight / 500) * 100)}% - 8px)` }}
              />
            </div>
            <button
              onClick={() => setWeight((w) => Math.min(500, w + 10))}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-primary hover:bg-muted/70"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[20, 50, 100, 200].map((w) => (
              <button
                key={w}
                onClick={() => setWeight(w)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-bold transition',
                  weight === w ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                )}
              >
                {w} {t.kg}
              </button>
            ))}
          </div>
        </Card>
      </section>

      {/* Notes */}
      <section>
        <h3 className="mb-2 text-sm font-bold text-foreground">{t.notes}</h3>
        <div className="relative">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t.notesPlaceholder}
            className="min-h-20 resize-none bg-card ps-4 pe-10"
          />
        </div>
      </section>

      {/* Price estimate */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Calculator size={20} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-muted-foreground">{t.estimate}</p>
            <p className="text-xs text-muted-foreground">
              {distance} {t.km} · {(t.cargo as Record<string, string>)[selectedCargo]} · {pricing?.basePrice ?? 150} {t.dzd} + {pricing?.perKm ?? 60}/{t.km}
            </p>
          </div>
          <button
            onClick={() => setShowPricingSheet(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/70"
          >
            <Settings2 size={15} />
          </button>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-3xl font-black text-primary">{formatDzd(estimatedPrice)} <span className="text-base">{t.dzd}</span></p>
            <p className="text-xs text-muted-foreground">{t.payout}</p>
          </div>
          <div className="flex flex-col gap-1 text-end">
            <span className="flex items-center justify-end gap-1 text-[11px] font-semibold text-emerald-600">
              <ShieldCheck size={12} /> {t.cargoInsurance}
            </span>
            <span className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[#FF7A00]">
              <Clock size={12} /> 12-18 {t.min}
            </span>
          </div>
        </div>
      </Card>

      {/* Request button */}
      <Button
        onClick={handleRequest}
        disabled={submitting}
        size="lg"
        className="h-14 w-full rounded-2xl bg-primary text-base font-bold shadow-xl"
      >
        <Bike size={22} className="me-2" />
        {t.requestTriporteur}
        <span className="ms-2 rounded-full bg-white/20 px-2.5 py-0.5 text-sm">
          {formatDzd(estimatedPrice)} {t.dzd}
        </span>
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <CloudOff size={12} />
        {t.offlineDesc}
      </p>

      {/* Pricing info sheet (read-only for customer) */}
      <Sheet open={showPricingSheet} onOpenChange={setShowPricingSheet}>
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-full max-w-sm">
          <SheetHeader>
            <SheetTitle>{t.priceConfig}</SheetTitle>
            <SheetDescription>
              {isAr ? 'يمكن للإدارة تعديل التسعير في الوقت الحقيقي عبر لوحة التحكم' : 'Modifiable par l\'administration'}
            </SheetDescription>
          </SheetHeader>
          {pricing && (
            <div className="mt-4 space-y-3">
              <PriceRow label={t.basePrice} value={`${pricing.basePrice} ${t.dzd}`} />
              <PriceRow label={t.perKm} value={`${pricing.perKm} ${t.dzd}`} />
              <div className="pt-2">
                <p className="mb-2 text-xs font-bold text-muted-foreground">{t.cargoMultiplier}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {CARGO_TYPES.map((c) => (
                    <div key={c.key} className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">{(t.cargo as Record<string, string>)[c.key]}</span>
                      <span className="font-bold text-primary">×{pricing.multipliers[c.key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LocationRow({
  icon, label, value, options, onSelect, isRtl,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: string[];
  onSelect: (idx: number) => void;
  isRtl: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <Select value={value} onValueChange={(v) => onSelect(options.indexOf(v))}>
          <SelectTrigger className="h-8 border-0 p-0 text-sm font-bold text-foreground focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ChevronDown size={16} className={cn('text-muted-foreground', isRtl && 'rotate-180')} />
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}
