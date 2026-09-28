'use client';

// ---------------------------------------------------------------------------
// CARGO DEDICATED FLOW (Phase 4) — the cargo-only order wizard.
//
// The legacy `CustomerHome` form is one long screen that asks the same
// questions for every service (taxi or parcel). A cargo job is different in
// kind: the customer has to describe WHAT is being moved and HOW BIG it is,
// because size decides which vehicles may carry it (a "large" shipment is
// truck-scale and must never be visible to a motorbike) and whether the job
// needs a photo for a driver to price it at all.
//
// So cargo orders now run through this dedicated step-by-step flow:
//   1 pickup -> 2 dropoff -> 3 cargo type -> 4 size -> 5 vehicle
//   -> 6 description -> 7 photo -> 8 review
// while taxi keeps the existing single-screen form (a passenger request has
// nothing to describe or photograph). Design notes:
//
//  * ONE state object (`OrderFormState`, see order-form.ts) is threaded
//    through every step as `OrderFormApi`, so steps stay small presentational
//    pieces and the review step / submit read the same source of truth.
//  * Every rule the wizard enforces in the UI is ALSO enforced by
//    POST /api/orders (size + vehicle contradiction, image host allow-list,
//    duplicate-submit guard). Client gates are UX, never the contract.
//  * A cargo order is always negotiable server-side (Phase 4), so the review
//    step presents the number as an estimate and says the driver agrees the
//    final price through offers.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, ArrowRight, Bike, Camera, Car, Check, Crosshair, ImagePlus,
  Loader2, MapPin, Package, Truck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../use-t';
import { api } from '@/lib/api';
import { emitOrderCreated } from '@/lib/realtime';
import { useNavStore } from '@/lib/store';
import {
  CARGO_TYPES, GUERRARA_CENTER, calcPrice, formatDzd, haversineKm,
} from '@/lib/wassilha-data';
import {
  CARGO_SIZES, CARGO_SIZE_LABELS, CARGO_SIZE_WEIGHT,
} from '@/lib/types';
import type { CargoKey, CargoSize, PricingConfig, VehicleCategory } from '@/lib/types';
import { DeliveryPointPicker } from '../../delivery-point-picker';
import type {
  DeliveryAreaOption, DeliveryPointOption, DeliveryCoords,
} from '../../delivery-point-picker';
import { deliveryAreas, deliveryPoints } from '@/lib/delivery-data';
// Verified OSM coordinates for the picker points (empty by design until the
// geocoding script has been run — see customer-home.tsx for the rationale).
import { AREA_COORDS, POINT_COORDS } from '@/lib/area-coords.generated';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CargoIcon } from '../../cargo-icon';
import { cn } from '@/lib/utils';
import {
  initialOrderForm, WIZARD_VEHICLE_OPTIONS,
  type OrderFormApi, type OrderFormState,
} from './order-form';

// Pre-bake the picker data exactly like customer-home.tsx does: the local
// const arrays are tuples, the picker wants { id, nameAr, nameFr, ... }.
const PICKER_AREAS: ReadonlyArray<DeliveryAreaOption> = deliveryAreas.map(
  ([nameAr, nameFr, slug]) => ({ id: slug, nameAr, nameFr }),
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

/**
 * The wizard's steps, in order. Keys double as the i18n title suffix
 * (`cargoStepPickup`, `cargoStepDropoff`, …) so adding a step is one entry
 * here + one translation key.
 */
const STEPS = [
  'pickup', 'dropoff', 'type', 'size', 'vehicle', 'desc', 'photo', 'summary',
] as const;
type WizardStep = (typeof STEPS)[number];

const STEP_TITLE_KEY: Record<WizardStep, string> = {
  pickup: 'cargoStepPickup',
  dropoff: 'cargoStepDropoff',
  type: 'cargoStepType',
  size: 'cargoStepSize',
  vehicle: 'cargoStepVehicle',
  desc: 'cargoStepDesc',
  photo: 'cargoStepPhoto',
  summary: 'cargoStepSummary',
};

/** The per-size explanatory line shown under each tile on step 4. */
const SIZE_HINT_KEY: Record<CargoSize, string> = {
  small: 'cargoSizeSmallHint',
  medium: 'cargoSizeMediumHint',
  large: 'cargoSizeLargeHint',
};

/** lucide components for the vehicle tiles (the .ts table stays JSX-free). */
const VEHICLE_ICON: Record<'Bike' | 'Car' | 'Truck', typeof Bike> = { Bike, Car, Truck };

/**
 * Translation lookup for keys built at runtime (step titles, size labels,
 * vehicle categories). `Translation` is a closed object type, so a dynamic
 * key needs this narrow cast — same pattern `(t.cargo as Record<string,
 * string>)` already uses in customer-home.tsx.
 */
type TRef = Record<string, string>;

// InteractiveMap is dynamically imported with ssr:false because Leaflet
// touches `window` at module init (identical posture to customer-home.tsx).
const InteractiveMap = dynamic(
  () => import('../../interactive-map').then((m) => m.InteractiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-52 w-full animate-pulse rounded-2xl border border-border bg-emerald-50/40 dark:bg-emerald-950/20" />
    ),
  },
);

export function CargoCreateOrderWizard({ onExit }: { onExit: () => void }) {
  const { t, isAr, isRtl } = useT();
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);

  const [step, setStep] = useState<WizardStep>('pickup');
  const [form, setForm] = useState<OrderFormState>(initialOrderForm);
  const [errors, setErrors] = useState<Partial<Record<keyof OrderFormState, string>>>({});
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Photo upload / GPS spinner flags — kept separate from `submitting` so a
  // slow upload never looks like a stuck order submission.
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  // Which endpoint the delivery-point sheet is currently editing.
  const [pickerFor, setPickerFor] = useState<'pickup' | 'dropoff' | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api
      .getPricing()
      .then(setPricing)
      .catch(() => toast.error(isAr ? 'تعذر تحميل التسعير' : 'Tarifs indisponibles'));
  }, [isAr]);

  // Free-text addresses have no coords, so distance falls back to the flat
  // default the server also uses (see customer-home.tsx / lib/pricing.ts).
  const distance = useMemo(() => {
    if (form.pickupCoords && form.dropoffCoords) {
      return haversineKm(form.pickupCoords, form.dropoffCoords);
    }
    return 0.8;
  }, [form.pickupCoords, form.dropoffCoords]);

  const estimatedPrice = useMemo(() => {
    if (!pricing) return 0;
    const mult = pricing.multipliers[form.cargoType] ?? 1;
    return calcPrice(pricing.basePrice, pricing.perKm, distance, mult);
  }, [pricing, form.cargoType, distance]);

  /**
   * The single setter every step receives.
   *
   * It also enforces the one cross-step rule the wizard owns: picking a
   * "large" shipment drops a previously chosen motorbike (a large load never
   * travels on two wheels — POST /api/orders rejects that pair with
   * `vehicleTooSmallForCargo`, so clearing it here keeps the wizard from
   * walking the customer into a 400 they cannot fix from the current screen).
   */
  const set = (patch: Partial<OrderFormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (next.cargoSize === 'large' && next.requiredVehicleType === 'moto') {
        next.requiredVehicleType = null;
      }
      return next;
    });
    // Editing a field invalidates the "missing address" hints.
    setErrors({});
  };

  const apiObj: OrderFormApi = useMemo(
    () => ({ state: form, set, errors }),
    // `set` is stable enough for this render-scoped object (it only closes
    // over setState functions, which React keeps stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, errors],
  );

  const stepIndex = STEPS.indexOf(step);

  /** Validates the current step; returns true when it is fine to advance. */
  const validateStep = (which: WizardStep): boolean => {
    if (which === 'pickup' && !form.pickup.trim()) {
      setErrors({ pickup: isAr ? 'حدّد نقطة الانطلاق' : 'Indiquez le départ' });
      return false;
    }
    if (which === 'dropoff' && !form.dropoff.trim()) {
      setErrors({ dropoff: isAr ? 'حدّد الوجهة' : 'Indiquez la destination' });
      return false;
    }
    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    const next = STEPS[Math.min(stepIndex + 1, STEPS.length - 1)];
    setStep(next);
  };

  const goBack = () => {
    if (stepIndex === 0) {
      onExit();
      return;
    }
    setStep(STEPS[stepIndex - 1]);
  };

  /**
   * "Use my location" for the endpoint the current step edits. Mirrors
   * customer-home.tsx: the browser fix is only a *hint* the customer can
   * overwrite, and a failure is a toast, never a blocked form.
   */
  const useMyLocation = () => {
    const which = step === 'dropoff' ? 'dropoff' : 'pickup';
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error(isAr ? 'الموقع غير متوفر على هذا الجهاز' : 'Géolocalisation indisponible');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        set(
          which === 'pickup'
            ? { pickup: isAr ? 'موقعي الحالي' : 'Ma position', pickupCoords: coords }
            : { dropoff: isAr ? 'موقعي الحالي' : 'Ma position', dropoffCoords: coords },
        );
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error(isAr ? 'تعذر الحصول على الموقع' : 'Impossible de vous localiser');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  /**
   * Step 7 — upload the goods photo. The URL is stored only after the server
   * accepts it; POST /api/orders re-validates the blob host, so a tampered
   * URL can never reach a driver's request card.
   */
  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    // Local preview first so the customer sees their choice instantly.
    set({ photoPreview: URL.createObjectURL(file) });
    setUploading(true);
    try {
      const { url } = await api.uploadOrderImage(file);
      set({ photoUrl: url, photoPreview: url });
    } catch {
      toast.error(isAr ? 'تعذر رفع الصورة' : "Échec de l'envoi de la photo");
      set({ photoPreview: null });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = () => set({ photoUrl: null, photoPreview: null });

  /**
   * Step 8 — create the order. The payload mirrors customer-home's cargo
   * branch; the Phase 4 additions are `cargoSize` / `cargoImageUrl`, and the
   * server forces `isNegotiable` on for every cargo job.
   */
  const submit = async () => {
    if (!form.pickup.trim() || !form.dropoff.trim()) {
      setStep('pickup');
      toast.error(isAr ? 'حدّد الانطلاق والوجهة' : 'Indiquez départ et destination');
      return;
    }
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        cargoType: form.cargoType,
        pickup: form.pickup.trim(),
        dropoff: form.dropoff.trim(),
        distance,
        price: estimatedPrice,
        ...(form.pickupCoords
          ? { pickupLat: form.pickupCoords.lat, pickupLng: form.pickupCoords.lng }
          : {}),
        ...(form.dropoffCoords
          ? { dropoffLat: form.dropoffCoords.lat, dropoffLng: form.dropoffCoords.lng }
          : {}),
        notes: form.notes.trim() || undefined,
        requiredVehicleType: form.requiredVehicleType,
        cargoSize: form.cargoSize,
        cargoImageUrl: form.photoUrl,
      });
      emitOrderCreated(order);
      setActiveOrderId(order.id);
      setCustomerTab('track');
      toast.success(t.cargoOrderCreatedToast);
    } catch (e) {
      // The server's duplicate-submit guard (409) carries the live order's
      // id: jump straight to its tracking screen instead of showing a raw
      // error, because the customer's order DID go through.
      const detail = String(e);
      if (detail.includes('duplicateSubmit')) {
        toast.error(t.duplicateOrderToast);
        setCustomerTab('track');
        return;
      }
      toast.error(isAr ? 'تعذر إنشاء الطلب' : 'création impossible');
    } finally {
      setSubmitting(false);
    }
  };

  const tt = (key: string) => ((t as unknown as TRef)[key] ?? key);
  const isLast = stepIndex === STEPS.length - 1;
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header: back / title / step counter + progress rail */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goBack} aria-label={t.cargoBack}>
          <ArrowLeft className={cn('rtl:rotate-180', !isRtl && 'rotate-0')} />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-extrabold text-foreground">{tt(STEP_TITLE_KEY[step])}</h2>
          <p className="text-[11px] text-muted-foreground">
            {stepIndex + 1} / {STEPS.length} {t.cargoStepOf}
          </p>
        </div>
        <Package size={20} className="text-primary" />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ------------------------------ STEP BODIES ------------------------------ */}
      {(step === 'pickup' || step === 'dropoff') && (
        <Card className="space-y-3 p-4">
          <LocationStep
            which={step}
            api={apiObj}
            t={t}
            isAr={isAr}
            locating={locating}
            pickerOpen={pickerFor !== null}
            onOpenPicker={() => setPickerFor(step)}
            onUseMyLocation={useMyLocation}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t.cargoLocationHint}</p>
        </Card>
      )}

      {step === 'type' && (
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-2">
            {CARGO_TYPES.filter((c) => c.key !== 'taxi').map((c) => (
              <TileButton
                key={c.key}
                active={form.cargoType === c.key}
                onClick={() => set({ cargoType: c.key })}
              >
                <CargoIcon cargo={c.key} size={22} />
                <span className="mt-1 block text-[11px] font-bold leading-tight">
                  {(t.cargo as Record<string, string>)[c.key]}
                </span>
              </TileButton>
            ))}
          </div>
        </Card>
      )}

      {step === 'size' && (
        <Card className="space-y-3 p-4">
          {CARGO_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => set({ cargoSize: size })}
              className={cn(
                'flex w-full items-start gap-3 rounded-2xl border-2 p-3 text-start transition',
                form.cargoSize === size
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/40',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                  form.cargoSize === size ? 'border-primary bg-primary text-white' : 'border-border',
                )}
              >
                {form.cargoSize === size ? <Check size={12} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold">{tt(CARGO_SIZE_LABELS[size])}</span>
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  {tt(SIZE_HINT_KEY[size])}
                </span>
              </span>
            </button>
          ))}
          {form.cargoSize === 'large' ? (
            <p className="rounded-xl bg-amber-500/10 p-2.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              {t.cargoLargeNotForMoto}
            </p>
          ) : null}
        </Card>
      )}


      {step === 'vehicle' && (
        <Card className="space-y-3 p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t.cargoVehicleHint}</p>
          <div className="grid grid-cols-2 gap-2">
            <TileButton
              active={form.requiredVehicleType === null}
              onClick={() => set({ requiredVehicleType: null })}
            >
              <MapPin size={22} />
              <span className="mt-1 block text-[11px] font-bold leading-tight">{t.cargoAnyVehicle}</span>
            </TileButton>
            {WIZARD_VEHICLE_OPTIONS.map((opt) => {
              const Icon = VEHICLE_ICON[opt.icon];
              // Large cargo never travels on two wheels — the tile stays
              // visible but disabled so the rule is explained, not hidden.
              const disabled = opt.value === 'moto' && form.cargoSize === 'large';
              return (
                <TileButton
                  key={opt.value}
                  active={form.requiredVehicleType === opt.value}
                  disabled={disabled}
                  onClick={() =>
                    set({
                      requiredVehicleType:
                        form.requiredVehicleType === opt.value ? null : opt.value,
                    })
                  }
                >
                  <Icon size={22} />
                  <span className="mt-1 block text-[11px] font-bold leading-tight">
                    {tt(opt.labelKey)}
                  </span>
                </TileButton>
              );
            })}
          </div>
          {form.cargoSize === 'large' ? (
            <p className="rounded-xl bg-amber-500/10 p-2.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              {t.cargoLargeNotForMoto}
            </p>
          ) : null}
        </Card>
      )}
      {step === 'desc' && (
        <Card className="space-y-2 p-4">
          <Textarea
            rows={5}
            maxLength={500}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder={t.cargoDescPlaceholder}
          />
          <p className="text-end text-[11px] text-muted-foreground">{form.notes.length}/500</p>
        </Card>
      )}


      {step === 'photo' && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="text-sm font-extrabold text-foreground">{t.cargoPhotoTitle}</p>
            <p className="text-[11px] text-muted-foreground">{t.cargoPhotoHelp}</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
          />
          {form.photoPreview ? (
            <div className="relative overflow-hidden rounded-2xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.photoPreview} alt="" className="h-52 w-full object-cover" />
              <button
                type="button"
                onClick={removePhoto}
                aria-label={t.cargoPhotoRemove}
                className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition hover:border-primary/50"
            >
              {uploading ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
              <span className="text-xs font-bold">
                {uploading ? t.cargoPhotoUploading : t.cargoPhotoAdd}
              </span>
            </button>
          )}
        </Card>
      )}

      {step === 'summary' && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-extrabold text-foreground">{t.cargoSummaryTitle}</p>
          <SummaryRow label={t.pickup} value={form.pickup} />
          <SummaryRow label={t.dropoff} value={form.dropoff} />
          <SummaryRow
            label={t.cargoTypes}
            value={`${(t.cargo as Record<string, string>)[form.cargoType]} · ${tt(CARGO_SIZE_LABELS[form.cargoSize])}`}
          />
          <SummaryRow
            label={t.cargoStepVehicle}
            value={
              form.requiredVehicleType
                ? tt(
                    WIZARD_VEHICLE_OPTIONS.find((o) => o.value === form.requiredVehicleType)
                      ?.labelKey ?? form.requiredVehicleType,
                  )
                : t.cargoAnyVehicle
            }
          />
          {form.notes.trim() ? <SummaryRow label={t.cargoStepDesc} value={form.notes.trim()} /> : null}
          {form.photoUrl ? (
            <div className="overflow-hidden rounded-2xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.photoUrl} alt="" className="h-40 w-full object-cover" />
            </div>
          ) : null}
          <div className="rounded-2xl bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t.cargoEstimatedLabel}</span>
              <span className="text-lg font-black text-primary">
                {formatDzd(estimatedPrice)} {t.dzd}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t.cargoNegotiableNote}
            </p>
          </div>
        </Card>
      )}

      {/* ------------------------------ FOOTER NAV ------------------------------ */}
      <div className="flex items-center gap-2 pb-2">
        <Button variant="outline" onClick={goBack} className="min-w-24">
          <ArrowLeft className="me-1 rtl:rotate-180" />
          {t.cargoBack}
        </Button>
        <div className="flex-1" />
        {isLast ? (
          <Button onClick={() => void submit()} disabled={submitting} className="min-w-40">
            {submitting ? <Loader2 size={16} className="me-1 animate-spin" /> : <Check className="me-1" />}
            {t.cargoConfirmOrder}
          </Button>
        ) : (
          <Button onClick={goNext} className="min-w-32">
            {t.cargoNext}
            <ArrowRight className="ms-1 rtl:rotate-180" />
          </Button>
        )}
      </div>

      {/* Delivery point picker sheet — same posture as customer-home: the
          Leaflet map unmounts (`hidden`) while this Sheet is open so nothing
          paints over it on Android WebView. */}
      <Sheet open={pickerFor !== null} onOpenChange={(open) => !open && setPickerFor(null)}>
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-full max-w-md overflow-y-auto p-4 z-[1100]">
          <SheetHeader className="mb-3">
            <SheetTitle>{pickerFor === 'pickup' ? t.pickup : t.dropoff}</SheetTitle>
          </SheetHeader>
          <DeliveryPointPicker
            areas={PICKER_AREAS}
            points={PICKER_POINTS}
            fallbackCoords={GUERRARA_CENTER as DeliveryCoords}
            coordsForArea={AREA_COORDS}
            pointCoords={POINT_COORDS}
            isRtl={isRtl}
            onSelect={(point, coords) => {
              const label = isAr ? point.nameAr : (point.nameFr ?? point.nameAr);
              set(
                pickerFor === 'dropoff'
                  ? { dropoff: label, dropoffCoords: coords }
                  : { pickup: label, pickupCoords: coords },
              );
              setPickerFor(null);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces shared by the steps. They receive the wizard's
// `OrderFormApi` (or plain props) and never own state, so the wizard remains
// the single source of truth.
// ---------------------------------------------------------------------------

/**
 * Step 1 / 2 body (pickup and dropoff share it — they differ only in which
 * fields of the form state they edit). A compact map previews the chosen
 * point, the text field keeps free-text addresses working for customers
 * whose area has no curated points, and the two buttons cover the quick
 * paths: curated-point sheet and browser geolocation.
 */
function LocationStep({
  which, api, t, isAr, locating, pickerOpen, onOpenPicker, onUseMyLocation,
}: {
  which: 'pickup' | 'dropoff';
  api: OrderFormApi;
  t: ReturnType<typeof useT>['t'];
  isAr: boolean;
  locating: boolean;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onUseMyLocation: () => void;
}) {
  const text = which === 'pickup' ? api.state.pickup : api.state.dropoff;
  const coords = which === 'pickup' ? api.state.pickupCoords : api.state.dropoffCoords;
  const error = api.errors[which];
  return (
    <div className="space-y-3">
      <InteractiveMap
        height="h-44"
        hidden={pickerOpen}
        defaultCenter={GUERRARA_CENTER}
        pickupCoords={which === 'pickup' ? coords : api.state.pickupCoords}
        dropoffCoords={which === 'dropoff' ? coords : api.state.dropoffCoords}
        pickupLabel={isAr ? 'الانطلاق' : 'Départ'}
        dropoffLabel={isAr ? 'الوجهة' : 'Arrivée'}
      />
      <div className="relative">
        <MapPin size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) =>
            api.set(which === 'pickup' ? { pickup: e.target.value } : { dropoff: e.target.value })
          }
          placeholder={isAr ? 'حي، شارع، أو معلم معروف' : 'Quartier, rue ou point connu'}
          className={cn('ps-9', error && 'border-destructive')}
        />
      </div>
      {error ? <p className="text-[11px] font-bold text-destructive">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onOpenPicker}>
          <Camera className="me-1" />
          {isAr ? 'من نقاط التسليم' : 'Points de livraison'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onUseMyLocation}
          disabled={locating}
        >
          {locating ? <Loader2 size={14} className="me-1 animate-spin" /> : <Crosshair className="me-1" />}
          {t.cargoUseMyLocation}
        </Button>
      </div>
      {coords ? (
        <p className="text-[11px] text-muted-foreground">
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </p>
      ) : null}
    </div>
  );
}

/** Selectable grid tile used by the type / vehicle steps. */
function TileButton({
  active, disabled, onClick, children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-2xl border-2 p-3 text-center transition',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-foreground hover:border-primary/40',
        disabled && 'cursor-not-allowed opacity-40 hover:border-border',
      )}
    >
      {children}
    </button>
  );
}

/** Label / value line inside the review card. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-end text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

