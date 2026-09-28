// ---------------------------------------------------------------------------
// CARGO DEDICATED FLOW (Phase 4) — the shape + helpers shared by the
// multi-step order wizard (cargo-wizard/). Kept in its own module so each
// step file imports the contract, not the wizard (no circular imports).
// ---------------------------------------------------------------------------
import type { CargoKey, CargoSize, VehicleCategory } from '@/lib/types';
import { VEHICLE_CATEGORY_LABELS } from '@/lib/types';

export type { CargoSize };

export interface OrderFormState {
  pickup: string;
  dropoff: string;
  pickupCoords: { lat: number; lng: number } | null;
  dropoffCoords: { lat: number; lng: number } | null;
  cargoType: CargoKey;
  cargoSize: CargoSize;
  // null = "any vehicle" (the customer has no preference; the server's
  // size rules still hide the order from vehicles that cannot carry it).
  // Typed as the shared `VehicleCategory` union so the value flows straight
  // into `api.createOrder({ requiredVehicleType })` without a cast.
  requiredVehicleType: VehicleCategory | null;
  notes: string;
  // SCHEDULED BOOKINGS (kept feature-parity with the legacy form): raw
  // `datetime-local` value, '' = "as soon as possible". Converted to an ISO
  // string on submit; the server derives `status = 'scheduled'` from it.
  scheduledAt: string;
  // Vercel Blob URL of the goods photo (uploaded on step 6) + the local
  // object URL previewed until the upload lands.
  photoUrl: string | null;
  photoPreview: string | null;
}

export const initialOrderForm: OrderFormState = {
  pickup: '',
  dropoff: '',
  pickupCoords: null,
  dropoffCoords: null,
  cargoType: 'parcel',
  cargoSize: 'small',
  requiredVehicleType: null,
  notes: '',
  scheduledAt: '',
  photoUrl: null,
  photoPreview: null,
};

/** Everything a step needs: live state, a patch setter, field errors. */
export interface OrderFormApi {
  state: OrderFormState;
  set: (patch: Partial<OrderFormState>) => void;
  errors: Partial<Record<keyof OrderFormState, string>>;
}

/**
 * The vehicle categories the customer may pick on step 5 (of the
 * `VEHICLE_CATEGORIES` vocabulary in types.ts). The taxi-only categories
 * are deliberately absent — this wizard is the CARGO flow.
 *
 * Labels reuse `VEHICLE_CATEGORY_LABELS` so a category reads identically in
 * the driver profile, the legacy order form and here. `icon` is a small
 * union the wizard maps to lucide components (this file stays .ts, no JSX).
 *
 * `moto` is NOT special-cased here — step 5 disables it when the size picked
 * on step 4 is "large", and POST /api/orders rejects the same combination
 * with `vehicleTooSmallForCargo`, so UI and API can never disagree.
 */
export const WIZARD_VEHICLE_OPTIONS: {
  value: VehicleCategory;
  labelKey: string;
  icon: 'Bike' | 'Car' | 'Truck';
}[] = [
  { value: 'moto', labelKey: VEHICLE_CATEGORY_LABELS.moto, icon: 'Bike' },
  { value: 'tricycle', labelKey: VEHICLE_CATEGORY_LABELS.tricycle, icon: 'Car' },
  { value: 'van', labelKey: VEHICLE_CATEGORY_LABELS.van, icon: 'Truck' },
  { value: 'truck', labelKey: VEHICLE_CATEGORY_LABELS.truck, icon: 'Truck' },
];