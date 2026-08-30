'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Minus, Plus, Calculator, Bike, ShieldCheck, Clock, CloudOff,
  MapPin, Flag, Settings2, Check,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  CARGO_TYPES, GUERRARA_CENTER, haversineKm, calcPrice, formatDzd,
} from '@/lib/wassilha-data';
import { emitOrderCreated } from '@/lib/realtime';
import { useNavStore } from '@/lib/store';
// InteractiveMap is dynamically imported with ssr:false because Leaflet
// touches `window` at module init. The bundled component is loaded only
// on the client; during SSR a lightweight placeholder div is rendered.
const InteractiveMap = dynamic(
  () => import('../interactive-map').then((m) => m.InteractiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-52 w-full animate-pulse rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20" />
    ),
  },
);
import { CargoIcon } from '../cargo-icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CargoKey, PricingConfig } from '@/lib/types';
import {
  DeliveryPointPicker,
  type DeliveryAreaOption,
  type DeliveryPointOption,
  type DeliveryCoords,
} from '../delivery-point-picker';
import { deliveryAreas, deliveryPoints } from '@/lib/delivery-data';

type PickDropoffPoint = DeliveryPointOption & { coords: DeliveryCoords };

// Pre-bake the picker data: the local const arrays are tuples, the picker
// wants a richer shape (id, nameAr, nameFr, type, areaId). Slugs become
// ids so we can join points → areas.
const PICKER_AREAS: ReadonlyArray<DeliveryAreaOption> = deliveryAreas.map(
  ([nameAr, nameFr, slug]) => ({
    id: slug,
    nameAr,
    nameFr,
  }),
);

const PICKER_POINTS: ReadonlyArray<DeliveryPointOption> = deliveryPoints.map(
  ([areaSlug, nameAr, nameFr, type]) => ({
    id: `${areaSlug}--${nameAr}`,
    nameAr,
    nameFr,
    type,
    areaId: areaSlug,
  }),
);

// Per-area fallback coords. Verified centers are added in a follow-up PR
// once the admin tooling is in place; until then every point resolves to
// the city center. This is documented in the README and the picker UI
// shows the resolved coords so the customer can confirm.
const COORDS_FOR_AREA: Readonly<Record<string, DeliveryCoords>> = {
  // Verified centroids will go here. None are fabricated at this stage.
};

export function CustomerHome() {
  const { t, isAr, isRtl } = useT();
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);

  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [selectedCargo, setSelectedCargo] = useState<CargoKey>('parcel');
  const [pickupPoint, setPickupPoint] = useState<PickDropoffPoint | null>(null);
  const [dropoffPoint, setDropoffPoint] = useState<PickDropoffPoint | null>(null);
  const [weight, setWeight] = useState(20);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPricingSheet, setShowPricingSheet] = useState(false);
  const [pickerFor, setPickerFor] = useState<'pickup' | 'dropoff' | null>(null);

  useEffect(() => {
    api.getPricing().then(setPricing).catch(() => toast.error(isAr ? 'تعذر تحميل التسعير' : 'Tarifs indisponibles'));
  }, [isAr]);

  const distance = useMemo(() => {
    if (!pickupPoint || !dropoffPoint) return 0.8;
    return Math.max(0.8, haversineKm(pickupPoint.coords, dropoffPoint.coords));
  }, [pickupPoint, dropoffPoint]);

  const estimatedPrice = useMemo(() => {
    if (!pricing) return 0;
    const mult = pricing.multipliers[selectedCargo] ?? 1;
    return calcPrice(pricing.basePrice, pricing.perKm, distance, mult);
  }, [pricing, selectedCargo, distance]);

  const handleRequest = async () => {
    if (!pickupPoint || !dropoffPoint) {
      toast.error(isAr ? 'اختر نقطة الاستلام ونقطة التوصيل' : 'Choisissez les deux points');
      return;
    }
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        cargoType: selectedCargo,
        pickup: pickupPoint.nameAr,
        dropoff: dropoffPoint.nameAr,
        weight,
        distance,
        price: estimatedPrice,
        notes: notes || undefined,
        pickupLat: pickupPoint.coords.lat,
        pickupLng: pickupPoint.coords.lng,
        dropoffLat: dropoffPoint.coords.lat,
        dropoffLng: dropoffPoint.coords.lng,
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
      {/* Map preview.
          -----------
          While ANY modal Sheet (the pricing breakdown OR the
          DeliveryPointPicker) is open, we completely take the Leaflet map
          out of the paint tree. Two complementary mechanisms are used
          because neither alone was reliable on Android WebView:

          1. `visibility: hidden` on the wrapper div keeps the layout
             stable (no jump when the sheet closes) AND removes the
             wrapper from the accessibility tree / hit-testing, but the
             real reason is: Chromium WebView still sometimes composites
             `visibility: hidden` descendants if they have a `transform`
             — so this is just defence #1.

          2. `hidden={true}` on `InteractiveMap` skips rendering the
             `MapContainer` itself (the wrapper still renders so the
             height stays the same). With no map DOM, no tile <img>s,
             and no GPU layer, there is literally nothing to out-paint
             the Sheet. This is the real fix.

          See `globals.css` for the matching z-index defense on the
          Sheet itself (Layer 1). The combination of (1) + (2) + the
          CSS rules has held on every Android WebView build we tested. */}
      <div
        aria-hidden={showPricingSheet || pickerFor !== null}
        style={{
          // `visibility: hidden` is preferred over `display: none` so
          // the card height stays put and we don't see a vertical jump
          // when the sheet closes.
          visibility:
            showPricingSheet || pickerFor !== null ? 'hidden' : 'visible',
        }}
      >
      <InteractiveMap
        hidden={showPricingSheet || pickerFor !== null}
        pickupCoords={pickupPoint?.coords ?? null}
        dropoffCoords={dropoffPoint?.coords ?? null}
        pickupLabel={pickupPoint?.nameAr ?? (isAr ? 'حدد نقطة الاستلام' : 'Pickup')}
        dropoffLabel={dropoffPoint?.nameAr ?? (isAr ? 'حدد نقطة التوصيل' : 'Dropoff')}
        defaultCenter={GUERRARA_CENTER}
        // Zoom 13 (was 14): keeps the El Guerrara city outline comfortably
        // framed in a 176px-tall card while avoiding the very-close zoom
        // levels (15+) where OpenStreetMap starts printing individual
        // street names (e.g. "AFRARE") directly on the raster tiles —
        // those are part of the tile image, not a Leaflet overlay, so the
        // only way to hide them is to step the zoom out one level.
        defaultZoom={13}
        height="h-44"
      />
      </div>

      {/* Pickup / dropoff selection (careem-style) */}
      <Card className="divide-y overflow-hidden p-0">
        <DeliveryLocationRow
          icon={<MapPin size={16} className="text-primary" />}
          label={t.pickup}
          value={pickupPoint?.nameAr ?? ''}
          placeholder={isAr ? 'اختر نقطة الاستلام' : 'Choisir un point de ramassage'}
          onPress={() => setPickerFor('pickup')}
        />
        <DeliveryLocationRow
          icon={<Flag size={16} className="text-[#FF7A00]" />}
          label={t.dropoff}
          value={dropoffPoint?.nameAr ?? ''}
          placeholder={isAr ? 'اختر نقطة التوصيل' : 'Choisir un point de livraison'}
          onPress={() => setPickerFor('dropoff')}
        />
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
                  'flex flex-col items-center gap-1 rounded-xl border p-2 transition',
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                <CargoIcon cargo={cargo.key} size={18} className={cn('h-7 w-7', selected ? '!text-primary' : 'text-muted-foreground')} />
                <span className="text-[11px] font-bold">{(t.cargo as Record<string, string>)[cargo.key]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Weight stepper */}
      <Card className="flex items-center justify-between p-3.5">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">{t.weight}</p>
          <p className="text-lg font-bold text-foreground">{weight} {t.kg}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setWeight((w) => Math.max(1, w - 5))}
            className="h-9 w-9 rounded-full"
            aria-label="decrease"
          >
            <Minus size={16} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setWeight((w) => Math.min(500, w + 5))}
            className="h-9 w-9 rounded-full"
            aria-label="increase"
          >
            <Plus size={16} />
          </Button>
        </div>
      </Card>

      {/* Notes */}
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">{t.notes}</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t.notesPlaceholder}
          className="resize-none"
          rows={2}
        />
      </div>

      {/* Estimate + actions */}
      <Card className="flex items-center justify-between bg-muted/50 p-3.5">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-primary" />
          <p className="text-sm font-bold text-foreground">{t.estimate}</p>
        </div>
        <p className="text-lg font-black text-primary">
          {formatDzd(estimatedPrice)} {t.dzd}
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 p-2">
          <ShieldCheck size={16} className="text-primary" />
          <p className="text-[10px] text-muted-foreground">{t.cargoInsurance ?? 'محمي'}</p>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 p-2">
          <Clock size={16} className="text-primary" />
          <p className="text-[10px] text-muted-foreground">{t.estTime ?? 'تقدير'}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPricingSheet(true)}
          className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 p-2"
        >
          <Settings2 size={16} className="text-primary" />
          <p className="text-[10px] text-muted-foreground">{t.pricing}</p>
        </button>
      </div>

      <Button
        onClick={handleRequest}
        disabled={submitting || !pickupPoint || !dropoffPoint}
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

      {/* Delivery point picker sheet (Phase 5) */}
      <Sheet
        open={pickerFor !== null}
        onOpenChange={(open) => !open && setPickerFor(null)}
      >
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-full max-w-md overflow-y-auto p-4 z-[1100]">
          <SheetHeader className="mb-3">
            <SheetTitle>
              {pickerFor === 'pickup' ? t.pickup : t.dropoff}
            </SheetTitle>
            <SheetDescription>
              {isAr
                ? 'اختر الحي ثم نقطة التسليم الدقيقة'
                : 'Choisissez un quartier puis un point précis'}
            </SheetDescription>
          </SheetHeader>
          <DeliveryPointPicker
            areas={PICKER_AREAS}
            points={PICKER_POINTS}
            fallbackCoords={GUERRARA_CENTER as DeliveryCoords}
            coordsForArea={COORDS_FOR_AREA}
            isRtl={isRtl}
            onSelect={(point, coords) => {
              const enriched = { ...point, coords };
              if (pickerFor === 'pickup') {
                setPickupPoint(enriched);
              } else if (pickerFor === 'dropoff') {
                setDropoffPoint(enriched);
              }
              setPickerFor(null);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DeliveryLocationRow({
  icon,
  label,
  value,
  placeholder,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}) {
  const hasValue = value.length > 0;
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-3 p-3.5 text-right transition hover:bg-muted/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0 flex-1 text-right">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p
          className={cn(
            'truncate text-sm font-bold',
            hasValue ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {hasValue ? value : placeholder}
        </p>
      </div>
      <span className="text-xs font-semibold text-primary">غيّر</span>
    </button>
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