'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Minus, Plus, Calculator, Bike, ShieldCheck, Clock, CloudOff,
  Settings2, Check, Loader2, Crosshair, Navigation, MapPin, Car,
  Package, Zap, CalendarClock,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  CARGO_TYPES, GUERRARA_CENTER, calcPrice, formatDzd,
} from '@/lib/wassilha-data';
import { emitOrderCreated } from '@/lib/realtime';
import type { DeliveryAreaOption, DeliveryPointOption, DeliveryCoords } from '../delivery-point-picker';
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
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CargoKey, PricingConfig } from '@/lib/types';
import { DeliveryPointPicker } from '../delivery-point-picker';
import { deliveryAreas, deliveryPoints } from '@/lib/delivery-data';

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
  // `serviceMode` picks between the two top-level tabs above the form:
  //   - 'cargo' → the original triporteur flow (parcels, furniture, …)
  //   - 'taxi'  → passenger transport (Yassir-like). Hides the weight
  //               slider + cargo grid + notes, swaps the button label,
  //               and sends `cargoType: 'taxi'` to the API.
  // Backward compatibility: defaults to 'cargo' so existing users see
  // the same screen they were used to.
  const [serviceMode, setServiceMode] = useState<'cargo' | 'taxi'>('cargo');
  const [selectedCargo, setSelectedCargo] = useState<CargoKey>('parcel');
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');
  const [weight, setWeight] = useState(20);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPricingSheet, setShowPricingSheet] = useState(false);
  const [pickerFor, setPickerFor] = useState<'pickup' | 'dropoff' | null>(null);
  // SCHEDULED BOOKINGS: when `bookingMode === 'scheduled'`, the
  // customer picks a future date+time via the `datetime-local` input
  // (stored as a local-time string in `scheduledAt`). The form submit
  // converts that string to an ISO timestamp and forwards it to the
  // API. The mode is held across cargo/taxi toggles so flipping the
  // service tab does not silently drop a scheduled booking.
  const [bookingMode, setBookingMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  // "Use my location" state — when non-null, the InteractiveMap renders
  // a pickup marker at these coordinates. The `locating` flag drives the
  // spinner on the GPS button.
  const [userLocation, setUserLocation] =
    useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    api.getPricing().then(setPricing).catch(() => toast.error(isAr ? 'تعذر تحميل التسعير' : 'Tarifs indisponibles'));
  }, [isAr]);

  // Free-text inputs have no coords, so distance falls back to the default.
  const distance = useMemo(() => 0.8, []);

  const estimatedPrice = useMemo(() => {
    if (!pricing) return 0;
    // In taxi mode the cargo grid is hidden and `selectedCargo` is
    // irrelevant — we just look up the `taxi` multiplier from the
    // pricing table. The server-authoritative price is recomputed
    // again on POST, so this is purely a UX estimate.
    const effectiveKey: CargoKey = serviceMode === 'taxi' ? 'taxi' : selectedCargo;
    const mult = pricing.multipliers[effectiveKey] ?? 1;
    return calcPrice(pricing.basePrice, pricing.perKm, distance, mult);
  }, [pricing, selectedCargo, serviceMode, distance]);

  const handleRequest = async () => {
    const pickupTrimmed = pickupText.trim();
    const dropoffTrimmed = dropoffText.trim();
    if (!pickupTrimmed || !dropoffTrimmed) {
      toast.error(isAr ? 'أدخل عنوان الاستلام وعنوان التوصيل' : 'Saisissez les deux adresses');
      return;
    }
    // SCHEDULED BOOKINGS: when the customer picked "Scheduled" but
    // forgot to fill the datetime input, surface a localized error
    // instead of silently sending `null` (which would create an
    // immediate order and confuse the customer).
    let scheduledIso: string | null = null;
    if (bookingMode === 'scheduled') {
      if (!scheduledAt) {
        toast.error(isAr ? 'اختر التاريخ والوقت للحجز' : 'Choisissez la date et l\'heure');
        return;
      }
      // `datetime-local` returns a local-time string (no timezone).
      // `new Date('2025-09-05T08:00')` interprets it in the local
      // timezone, which is exactly what the customer expects. We
      // re-check that the resulting timestamp is in the future
      // because the `min` attribute is a UX hint, not a hard gate.
      const parsed = new Date(scheduledAt);
      if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        toast.error(isAr ? 'وقت الحجز يجب أن يكون في المستقبل' : 'L\'heure doit être dans le futur');
        return;
      }
      scheduledIso = parsed.toISOString();
    }
    setSubmitting(true);
    try {
      // `serviceMode === 'taxi'` flips the API payload so the order is
      // categorized as passenger transport. We deliberately omit the
      // `weight` field (it's not meaningful for passengers) and let the
      // server fall back to a neutral default. We still send the
      // estimated `price` for analytics / the price sheet, but the
      // server recomputes the authoritative value from coordinates.
      const isTaxi = serviceMode === 'taxi';
      const order = await api.createOrder({
        cargoType: isTaxi ? 'taxi' : selectedCargo,
        pickup: pickupTrimmed,
        dropoff: dropoffTrimmed,
        // Only attach `weight` for cargo — keeps the taxi payload
        // small and matches what a real Yassir-like client would send.
        ...(isTaxi ? {} : { weight }),
        distance,
        price: estimatedPrice,
        // Notes are only relevant for cargo (fragile, "2nd floor",
        // etc.). For taxis the field is hidden in the UI; we still
        // pass an empty string so the server stores `null`.
        notes: isTaxi ? undefined : (notes || undefined),
        // SCHEDULED BOOKINGS: forward the ISO timestamp to the API
        // so the server can flip status to `scheduled` and skip
        // the immediate driver fan-out. For immediate ("now")
        // orders, we pass `null` (not `undefined`) so any
        // future-proofing in the schema that distinguishes
        // "explicitly not scheduled" from "not set" keeps working.
        scheduledAt: scheduledIso,
      });
      emitOrderCreated(order);
      setActiveOrderId(order.id);
      setCustomerTab('track');
      // Toast copy swaps based on the booking mode so the customer
      // gets clear feedback ("Booked for 8 AM!" vs "Order created").
      if (bookingMode === 'scheduled') {
        toast.success(
          isAr
            ? `تم حجز موعد ${new Date(scheduledAt).toLocaleString('ar-DZ', { dateStyle: 'short', timeStyle: 'short' })}`
            : `Réservation confirmée pour le ${new Date(scheduledAt).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' })}`,
          { duration: 6000 },
        );
      } else {
        toast.success(t.orderCreated);
      }
    } catch {
      toast.error(isAr ? 'فشل إنشاء الطلب' : 'Échec');
    } finally {
      setSubmitting(false);
    }
  };

  // "Use my location" — fetches GPS coords via the browser Geolocation API,
  // reverse-geocodes them with Nominatim (OpenStreetMap) to a human-readable
  // address, then populates the pickup field and drops a marker on the map.
  //
  // Privacy: nothing is sent to a third-party server until the user taps
  // the button. Nominatim's usage policy allows ~1 req/sec, which is fine
  // for a one-shot user action.
  const handleUseMyLocation = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      toast.error(t.locationUnavailable);
      return;
    }
    if (locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        // Reverse-geocode to a human-readable address. We try Arabic first
        // (since the app's primary locale is AR) and fall back to the
        // default locale string if Nominatim doesn't return an Arabic
        // display name. If the network call fails entirely we still set
        // the marker + a coords string so the user can see *something*
        // on the map and adjust manually.
        try {
          const url =
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
            `&lat=${latitude}&lon=${longitude}` +
            `&accept-language=${isAr ? 'ar' : 'fr'}`;
          const res = await fetch(url, {
            headers: { 'Accept': 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            const label: string | undefined = data?.display_name;
            if (label) {
              setPickupText(label);
              toast.success(t.locationFound);
            } else {
              setPickupText(
                isAr
                  ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                  : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
              );
              toast.info(t.locationAddressNotFound);
            }
          } else {
            setPickupText(
              `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            );
            toast.info(t.locationAddressNotFound);
          }
        } catch {
          // Network error — coords are still set, marker still drops, but
          // the user sees a soft warning and can type the address manually.
          setPickupText(
            `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          );
          toast.info(t.locationAddressNotFound);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast.error(t.locationDenied);
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          toast.error(t.locationUnavailable);
        } else if (err.code === err.TIMEOUT) {
          toast.error(t.locationTimeout);
        } else {
          toast.error(t.locationUnavailable);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      },
    );
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
        pickupCoords={userLocation}
        dropoffCoords={null}
        pickupLabel={pickupText || (isAr ? 'عنوان الاستلام' : 'Pickup')}
        dropoffLabel={dropoffText || (isAr ? 'عنوان التوصيل' : 'Dropoff')}
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

      {/* Service mode toggle (cargo vs taxi) — sits above the pickup
          block so the choice is visible *before* the user starts
          filling the form. Backward-compatible: defaults to 'cargo'
          so users who land here from the bottom-nav see the same
          flow they had before. */}
      <div
        role="tablist"
        aria-label={isAr ? 'نوع الخدمة' : 'Type de service'}
        className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={serviceMode === 'cargo'}
          onClick={() => setServiceMode('cargo')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition',
            serviceMode === 'cargo'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Package size={16} />
          {t.goodsDelivery}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={serviceMode === 'taxi'}
          onClick={() => setServiceMode('taxi')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition',
            serviceMode === 'taxi'
              ? 'bg-yellow-400 text-yellow-950 shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Car size={16} />
          {t.passengerTransport}
        </button>
      </div>

      {/* Pickup / dropoff selection (careem-style) */}
      {/* "Use my location" button — sits directly above the pickup row
          so the affordance is obvious. When tapped, fills the pickup
          field via GPS + reverse-geocoding and drops a marker. */}
      <button
        type="button"
        onClick={handleUseMyLocation}
        disabled={locating}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-start transition',
          'hover:bg-primary/10 active:scale-[0.99]',
          'disabled:cursor-not-allowed disabled:opacity-70',
        )}
        aria-label={t.useMyLocation}
      >
        <span className="flex items-center gap-2 text-xs font-bold text-primary">
          {locating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Crosshair size={14} />
          )}
          <Navigation size={12} className="opacity-60" />
          {locating ? t.locating : t.useMyLocation}
        </span>
        {userLocation && !locating ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <MapPin size={10} />
            {userLocation.lat.toFixed(3)}, {userLocation.lng.toFixed(3)}
          </span>
        ) : null}
      </button>
      <Card className="divide-y overflow-hidden p-0">
        {/* Pickup/dropoff labels swap to "موقع الركوب / وجهة الوصول"
            when the passenger transport tab is active — same input
            component, just different translation. The accent colors
            stay the same (primary for pickup, orange for dropoff) so
            the visual language is consistent with the existing flow. */}
        <DeliveryLocationInput
          label={serviceMode === 'taxi' ? t.pickupLocation : t.pickup}
          value={pickupText}
          onChange={setPickupText}
          placeholder={t.pickupPlaceholder}
          accentClass="text-primary"
          isAr={isAr}
          onOpenPicker={() => setPickerFor('pickup')}
        />
        <DeliveryLocationInput
          label={serviceMode === 'taxi' ? t.dropoffLocation : t.dropoff}
          value={dropoffText}
          onChange={setDropoffText}
          placeholder={t.dropoffPlaceholder}
          accentClass="text-[#FF7A00]"
          isAr={isAr}
          onOpenPicker={() => setPickerFor('dropoff')}
        />
      </Card>

      {/* Cargo types — only shown in cargo mode. The taxi service
          doesn't expose a sub-type picker; the order is just
          `cargoType: 'taxi'` server-side. Hiding the grid (instead
          of graying it out) is the simplest way to communicate that
          the concept of "نوع الحمولة" doesn't apply. */}
      {serviceMode === 'cargo' && (
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
      )}

      {/* Weight stepper — only meaningful for cargo. Passengers don't
          have a weight slider (it's stored as a neutral default on
          the server). The `state` value is preserved across mode
          toggles so flipping back to cargo restores the last weight. */}
      {serviceMode === 'cargo' && (
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
      )}

      {/* Notes — only relevant for cargo. We keep the `notes` state
          across mode toggles but the textarea is hidden in taxi mode
          so the form is shorter and matches a Yassir-like flow. */}
      {serviceMode === 'cargo' && (
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
      )}

      {/* SCHEDULED BOOKINGS: a small two-option toggle ("Now" /
          "Scheduled") plus a `datetime-local` picker that appears
          only when the customer picks "Scheduled". Sits right
          above the price estimate so the cost and the trip time
          are visually grouped. The `min` attribute on the
          `datetime-local` input blocks past dates at the browser
          level, matching the server's Zod refinement. */}
      <div
        role="tablist"
        aria-label={isAr ? 'توقيت الحجز' : 'Horaire de la course'}
        className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={bookingMode === 'now'}
          onClick={() => {
            setBookingMode('now');
            setScheduledAt('');
          }}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition',
            bookingMode === 'now'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Zap size={14} />
          {t.now}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={bookingMode === 'scheduled'}
          onClick={() => setBookingMode('scheduled')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition',
            bookingMode === 'scheduled'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarClock size={14} />
          {t.scheduleForLater}
        </button>
      </div>
      {bookingMode === 'scheduled' && (
        <div className="rounded-2xl border border-border bg-muted/30 p-3">
          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
            {t.selectDateTime}
          </label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            // `min` is the next full minute so the customer can't
            // book a ride "for right now" via the picker. The server
            // also re-validates this in the Zod transform, so a
            // browser quirk or timezone math can never bypass it.
            min={(() => {
              const d = new Date(Date.now() + 60_000);
              const tz = d.getTimezoneOffset() * 60_000;
              return new Date(d.getTime() - tz).toISOString().slice(0, 16);
            })()}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="h-10 text-sm font-semibold"
          />
        </div>
      )}

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
        disabled={submitting || !pickupText.trim() || !dropoffText.trim()}
        size="lg"
        className={cn(
          'h-14 w-full rounded-2xl text-base font-bold shadow-xl',
          // Yellow CTA in taxi mode to match the Yassir-style "Book a
          // ride" affordance; primary green for cargo. Both use the
          // same `bg-*` classes Tailwind already knows about (no
          // runtime styles, fully SSR-safe).
          serviceMode === 'taxi'
            ? 'bg-yellow-400 text-yellow-950 hover:bg-yellow-500'
            : 'bg-primary text-primary-foreground'
        )}
      >
        {serviceMode === 'taxi' ? (
          <Car size={22} className="me-2" />
        ) : (
          <Bike size={22} className="me-2" />
        )}
        {serviceMode === 'taxi' ? t.requestTaxi : t.requestTriporteur}
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
            onSelect={(point) => {
              const label = isAr ? point.nameAr : (point.nameFr ?? point.nameAr);
              if (pickerFor === 'pickup') {
                setPickupText(label);
              } else if (pickerFor === 'dropoff') {
                setDropoffText(label);
              }
              setPickerFor(null);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DeliveryLocationInput({
  label,
  value,
  onChange,
  placeholder,
  accentClass,
  isAr,
  onOpenPicker,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  accentClass: string;
  isAr: boolean;
  onOpenPicker: () => void;
}) {
  // Free-text input with an inline fallback button that re-opens the
  // DeliveryPointPicker sheet. The picker still works as a quick way to
  // pick a known delivery point; whatever it returns is dropped into
  // the same text field (localized: Arabic in AR locale, French in FR).
  const hasValue = value.trim().length > 0;
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <label className={cn('mb-1 block text-[11px] font-semibold', accentClass)}>
          {label}
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={isAr ? 'rtl' : 'ltr'}
          className="h-9 border-0 bg-transparent p-0 text-sm font-bold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label={label}
        className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted"
      >
        <span aria-hidden>📍</span>
        <span>{hasValue ? (isAr ? 'غيّر' : 'Changer') : (isAr ? 'اختر' : 'Choisir')}</span>
      </button>
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