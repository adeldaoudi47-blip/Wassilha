// WASSILHA shared types

export type Role = 'customer' | 'driver' | 'admin' | 'artisan';
export type Lang = 'ar' | 'fr';

// ---------------------------------------------------------------------------
// VEHICLE CLASSIFICATION (Phase 1)
//
// The commercial category of a driver's vehicle. Used both on the driver
// profile / application form (`VehicleRegistration.vehicleCategory`) and on
// the customer order form (`Order.requiredVehicleType`) so the two sides
// share one vocabulary and the Phase 2 dispatch filter can join them.
//
// Kept as a plain string list (NOT a Prisma enum) so a new category can be
// added here + in the i18n table without a DB migration — the same pattern
// the codebase already uses for `Order.status` / `Driver.serviceType`.
//
// `null` / an empty string means "no category chosen" (legacy drivers and
// orders); the dispatch fan-out then treats it as "no preference".
// ---------------------------------------------------------------------------
export const VEHICLE_CATEGORIES = [
  'moto',
  'tricycle',
  'pickup',
  'van',
  'refrigerated',
  'truck',
  'taxi_car',
  'taxi_car_7',
  // OFFICIAL VOCABULARY (vehicle-classification task). These six are the
  // only values NEW writes accept; the seven above stay in the list because
  // live VehicleRegistration rows already carry them and must keep working
  // untouched. They are read through `normalizeVehicleCategory()` below, so
  // old and new never have to be rewritten to meet.
  'cargo_moto_2',
  'cargo_tricycle',
  'cargo_small_truck',
  'cargo_large_truck',
  'taxi_up_to_4',
  'taxi_over_5',
] as const;

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// OFFICIAL VEHICLE CLASSIFICATION — the six categories the product ships with,
// grouped by the service they can serve. This is the list every UI renders and
// every write path validates against; `VEHICLE_CATEGORIES` above is the wider
// storage vocabulary that also has to accept legacy rows.
// ---------------------------------------------------------------------------
export const OFFICIAL_VEHICLE_CATEGORIES = [
  'cargo_moto_2',
  'cargo_tricycle',
  'cargo_small_truck',
  'cargo_large_truck',
  'taxi_up_to_4',
  'taxi_over_5',
] as const;

export type OfficialVehicleCategory = (typeof OFFICIAL_VEHICLE_CATEGORIES)[number];

/** Which half of the platform a category belongs to (mirrors Driver.serviceType). */
export type VehicleServiceSide = 'CARGO' | 'TAXI';

export const CARGO_VEHICLE_CATEGORIES = [
  'cargo_moto_2',
  'cargo_tricycle',
  'cargo_small_truck',
  'cargo_large_truck',
] as const satisfies readonly OfficialVehicleCategory[];

export const TAXI_VEHICLE_CATEGORIES = [
  'taxi_up_to_4',
  'taxi_over_5',
] as const satisfies readonly OfficialVehicleCategory[];

/**
 * TAXI SEAT RANGES (a taxi category is a CAPACITY CLASS, not a fixed count).
 *
 * The category says which band the vehicle falls in; the seat count the driver
 * types is the real capacity and is stored verbatim, because that is what the
 * customer's `requiredSeats` is compared against in isVehicleCompatible().
 *
 *   taxi_up_to_4 → 1..4   ("4 seats or fewer")
 *   taxi_over_5  → 6..30  ("more than 5 seats" — a 6-seater is as valid as a
 *                          9-seater minibus)
 *
 * A previous revision pinned `taxi_over_5` to exactly 7 and compared with
 * `===`, which rejected perfectly valid vehicles (a 9-seat minibus returned
 * seatsMismatchVehicleCategory). The range model fixes that while still
 * refusing the genuinely contradictory pair (9 seats declared as "4 or fewer").
 */
export const TAXI_SEATS_MAX = 30;

export interface TaxiSeatRange {
  min: number;
  max: number;
}

export const TAXI_CATEGORY_SEAT_RANGE: Readonly<
  Record<'taxi_up_to_4' | 'taxi_over_5', TaxiSeatRange>
> = {
  taxi_up_to_4: { min: 1, max: 4 },
  taxi_over_5: { min: 6, max: TAXI_SEATS_MAX },
};

/** The seat band for a category, accepting any stored spelling (legacy or official). */
export function taxiSeatRange(category: unknown): TaxiSeatRange | null {
  const normalized = normalizeVehicleCategory(category);
  if (normalized === 'taxi_up_to_4' || normalized === 'taxi_over_5') {
    return TAXI_CATEGORY_SEAT_RANGE[normalized];
  }
  return null;
}

/**
 * Is `seats` a legal capacity for this taxi category?
 * Non-taxi (or unknown) categories have no seat rule and always pass, so this
 * is only consulted on the TAXI branch of the registration endpoint.
 */
export function isSeatsValidForTaxiCategory(category: unknown, seats: number): boolean {
  const range = taxiSeatRange(category);
  if (range === null) return true;
  return Number.isInteger(seats) && seats >= range.min && seats <= range.max;
}

/**
 * The smallest legal capacity for a category, used only when the driver
 * submitted no seat count at all. Kept at the conservative end of the band so
 * an unstated vehicle is never credited with more seats than it may have.
 */
export function defaultSeatsForTaxiCategory(category: unknown): number | null {
  return taxiSeatRange(category)?.min ?? null;
}

// Type guard used by the API layer to validate a client-supplied category
// before persisting it. Unknown values are rejected with a 400 rather than
// silently stored, so the vocabulary stays honest in the DB.
/**
 * LEGACY → OFFICIAL mapping.
 *
 * This is why no data migration of `VehicleRegistration` is needed: live rows
 * keep their Phase-1 vocabulary and are *interpreted* into the official one at
 * read time. A legacy driver and a newly registered driver therefore compare
 * equal without either row ever being rewritten.
 *
 * `truck` → `cargo_small_truck` is a DELIBERATE, DOCUMENTED choice. The four
 * production drivers in that bucket were classified from a free-text `marque`
 * ("هاربين", "Fourgo", "Huendai", "Jumpy") with no way to tell a petit camion
 * from a grand camion. Erring toward the *smaller* truck is the safe direction:
 * it keeps them eligible for every small-truck order (no lost income) while
 * never letting a vehicle that may be too small claim a large-truck load.
 * Splitting them later is a one-off UPDATE once the drivers can be asked.
 *
 * `pickup` / `van` / `refrigerated` are DELIBERATELY ABSENT. They carry zero
 * live rows, and folding them into `cargo_small_truck` would collapse a
 * distinction Phase 1 asserts: a `truck` must not match an order that requires
 * a `van`. Unmapped means "matches no categorical request", which is the safe
 * direction — a driver on an odd category simply is not auto-offered those
 * orders until an admin classifies them, instead of being offered work the
 * wrong vehicle would take.
 */
export const LEGACY_CATEGORY_EQUIVALENTS: Readonly<Record<string, OfficialVehicleCategory>> = {
  moto: 'cargo_moto_2',
  tricycle: 'cargo_tricycle',
  truck: 'cargo_small_truck',
  taxi_car: 'taxi_up_to_4',
  taxi_car_7: 'taxi_over_5',
};

export function isOfficialVehicleCategory(v: unknown): v is OfficialVehicleCategory {
  return typeof v === 'string' && (OFFICIAL_VEHICLE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Translate any stored category — official or legacy — into the official
 * vocabulary. Returns null when the value is unknown or unset ("no category on
 * file", a legal legacy state that never matches a categorical request).
 */
export function normalizeVehicleCategory(v: unknown): OfficialVehicleCategory | null {
  if (typeof v !== 'string' || v === '') return null;
  if (isOfficialVehicleCategory(v)) return v;
  return LEGACY_CATEGORY_EQUIVALENTS[v] ?? null;
}

/** CARGO or TAXI for any category (official or legacy); null when unknown. */
export function vehicleCategorySide(v: unknown): VehicleServiceSide | null {
  const n = normalizeVehicleCategory(v);
  if (n === null) return null;
  return (CARGO_VEHICLE_CATEGORIES as readonly string[]).includes(n) ? 'CARGO' : 'TAXI';
}

/**
 * Every raw string that may sit in the DB for one official category (the
 * canonical value plus its legacy spellings). Builds the SQL `in (...)`
 * pre-filter so the `@@index([vehicleCategory])` scan still applies while legacy
 * rows stay reachable.
 */
export function rawCategoryForms(official: OfficialVehicleCategory): string[] {
  const legacy = Object.entries(LEGACY_CATEGORY_EQUIVALENTS)
    .filter(([, v]) => v === official)
    .map(([k]) => k);
  return [official, ...legacy];
}

export function isVehicleCategory(v: unknown): v is VehicleCategory {
  return typeof v === 'string' && (VEHICLE_CATEGORIES as readonly string[]).includes(v);
}

export type VehicleTypesValidation =
  | { ok: true; value: OfficialVehicleCategory[] }
  | { ok: false; reason: 'unknownCategory' | 'mixedServices' | 'tooMany' | 'empty'; value: string };

/**
 * Drop any selected category that no longer belongs to the newly chosen
 * service, so switching CARGO <-> TAXI can never carry a stale value into the
 * next submit. Kept next to the vocabulary rather than duplicated in each form
 * (driver application, upgrade dialog, vehicle profile dialog).
 *
 * 'BOTH' accepts either family and therefore keeps whatever was selected.
 * An already-compatible selection is returned untouched — this only ever
 * removes, never adds, so it cannot silently pick a vehicle for the user.
 */
export function retainCategoriesForService(
  selected: readonly OfficialVehicleCategory[],
  service: VehicleServiceSide | 'BOTH',
): OfficialVehicleCategory[] {
  if (service === 'BOTH') return [...selected];
  return selected.filter((c) => vehicleCategorySide(c) === service);
}

/**
 * Normalize + validate a client-supplied list of required vehicle types.
 * Shared by the order API, the wizard and the driver form so those three can
 * never disagree about what a legal value is.
 *
 * A discriminated result rather than a throw, because every caller turns it
 * into a 400 carrying a specific message:
 *  - unknownCategory → outside both vocabularies (never silently stored)
 *  - mixedServices   → cargo + taxi in one list (structurally impossible)
 *  - tooMany         → more entries than categories that exist
 *  - empty           → an explicitly-supplied empty array is a 400; an ABSENT
 *                      field is the caller's "no preference" case
 *  - duplicates      → normalised away, not rejected: the client is a
 *                      multi-select checkbox group and repeats are harmless
 */
export function validateRequiredVehicleTypes(input: unknown): VehicleTypesValidation {
  if (!Array.isArray(input)) return { ok: false, reason: 'unknownCategory', value: String(input) };
  const normalised: OfficialVehicleCategory[] = [];
  for (const raw of input) {
    const n = normalizeVehicleCategory(raw);
    if (n === null) return { ok: false, reason: 'unknownCategory', value: String(raw) };
    if (!normalised.includes(n)) normalised.push(n);
  }
  if (normalised.length === 0) return { ok: false, reason: 'empty', value: '' };
  if (normalised.length > OFFICIAL_VEHICLE_CATEGORIES.length) {
    return { ok: false, reason: 'tooMany', value: String(input.length) };
  }
  const sides = new Set(normalised.map((c) => vehicleCategorySide(c)));
  if (sides.size > 1) return { ok: false, reason: 'mixedServices', value: normalised.join(',') };
  return { ok: true, value: normalised };
}

// Maps a category to its i18n key (defined for both `ar` and `fr` in
// src/lib/i18n.ts). Centralised here so the driver profile, the application
// form and the customer order form all render the same label for a given
// category — a category is only ever displayed through this table.
export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  moto: 'vehicleCategoryMoto',
  tricycle: 'vehicleCategoryTricycle',
  pickup: 'vehicleCategoryPickup',
  van: 'vehicleCategoryVan',
  refrigerated: 'vehicleCategoryRefrigerated',
  truck: 'vehicleCategoryTruck',
  taxi_car: 'vehicleCategoryTaxiCar',
  taxi_car_7: 'vehicleCategoryTaxiCar7',
  // Official six. Labels are grouped by service in the UI (the driver form and
  // the customer forms render the two sections separately), but every value is
  // displayable through this one table so a category never shows a raw key.
  cargo_moto_2: 'cargoMoto2',
  cargo_tricycle: 'cargoTricycle',
  cargo_small_truck: 'cargoSmallTruck',
  cargo_large_truck: 'cargoLargeTruck',
  taxi_up_to_4: 'taxiUpTo4',
  taxi_over_5: 'taxiOver5',
};

/** i18n keys for the two section headings in every vehicle picker. */
export const VEHICLE_GROUP_LABELS: Record<VehicleServiceSide, string> = {
  CARGO: 'cargoVehicles',
  TAXI: 'taxiVehicles',
};

/** The official categories of one service side, in display order. */
export const OFFICIAL_CATEGORIES_BY_SIDE: Record<VehicleServiceSide, OfficialVehicleCategory[]> = {
  CARGO: [...CARGO_VEHICLE_CATEGORIES],
  TAXI: [...TAXI_VEHICLE_CATEGORIES],
};

// Returns the localised label for a category, or the "unset" fallback when
// the driver has not chosen one yet. Exposed as a single helper so callers
// never have to repeat the `?? noVehicleCategory` dance.
export function vehicleCategoryLabel(
  t: Record<string, string>,
  category: VehicleCategory | null | undefined,
): string {
  if (!category) return t.noVehicleCategory ?? '—';
  return t[VEHICLE_CATEGORY_LABELS[category]] ?? category;
}

// The list the customer order form renders, in the order the UI shows it.
// Same vocabulary as the driver side; the empty-string value is the explicit
// "no preference" option.
export const VEHICLE_CATEGORY_OPTIONS: { value: VehicleCategory; labelKey: string }[] =
  VEHICLE_CATEGORIES.map((c) => ({ value: c, labelKey: VEHICLE_CATEGORY_LABELS[c] }));

export type CargoKey =
  | 'parcel'
  | 'goods'
  | 'shop'
  | 'furniture'
  | 'appliance'
  | 'construction'
  | 'personal'
  | 'other'
  // `taxi` is the passenger-transport service (Yassir-like). Added in
  // the same union so the existing Zod enum, pricing multipliers, and
  // `CARGO_TYPES` table all flow through one shape. The DB column
  // `Order.cargoType` is a free `String`, so no Prisma migration is
  // required — old rows are unaffected.
  | 'taxi'
  // `craft` is the Hirfa handmade delivery type. Orders with this
  // cargoType are delivery tasks for artisan products. The DB column
  // is a free String so no migration is needed.
  | 'craft'
  // `food` is the CARGO DEDICATED FLOW (Phase 4) restaurant / food-delivery
  // type. Like every Phase 4 addition it is additive: the DB column is a
  // free String, and pricing / dispatch treat it exactly like `parcel`
  // until admins tune its multiplier.
  | 'food';

// CARGO DEDICATED FLOW (Phase 4): how bulky the shipment is. Decoupled
// from the numeric `weight` (which pricing keeps using) so the wizard can
// ask one simple question. `large` blocks motorbikes in
// `isVehicleCompatible`; `weight` is derived from the size server-side.
export type CargoSize = 'small' | 'medium' | 'large';

export const CARGO_SIZES: readonly CargoSize[] = ['small', 'medium', 'large'] as const;

// i18n label keys per size (see translations: cargoSize* / cargoSize*Hint).
export const CARGO_SIZE_LABELS: Record<CargoSize, string> = {
  small: 'cargoSizeSmall',
  medium: 'cargoSizeMedium',
  large: 'cargoSizeLarge',
};

// The weight (kg) each size maps to for PRICING only. Chosen so the
// estimate lands near what the equivalent manual weight entry produced
// pre-Phase-4; customers never see it. Clamped by the existing 0..50000
// server validation.
export const CARGO_SIZE_WEIGHT: Record<CargoSize, number> = {
  small: 20,
  medium: 100,
  large: 400,
};
export type OrderStatus =
  | 'searching'
  // `scheduled` is the initial state of a future-dated booking. The
  // dispatcher (or a cron-like job) flips it to `searching` when the
  // scheduled time approaches, at which point the normal driver
  // fan-out kicks in. Drivers see scheduled orders in their
  // "incoming" feed so they can pre-accept them if they want.
  | 'scheduled'
  | 'accepted'
  | 'picked'
  | 'delivered'
  | 'cancelled';


export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'searching',
  'scheduled',
  'accepted',
  'picked',
] as const;

export function isActiveOrderStatus(status: OrderStatus | string | null | undefined): boolean {
  if (!status) return false;
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(status);
}

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: Role;
  avatar?: string | null;
}

export interface VehicleRegistrationInfo {
  id: string;
  numeroImmatriculation: string;
  typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
  nom: string | null;
  prenom: string | null;
  raisonSociale: string | null;
  marque: string;
  type: string | null;
  anneePremiereMiseCirculation: number;
  // VEHICLE CLASSIFICATION (Phase 1): the category the driver picked for
  // this vehicle (moto / pickup / refrigerated / …). Null for legacy rows
  // that never had one. Served to the driver on their profile so the
  // edit dialog can pre-select the right dropdown value.
  vehicleCategory?: VehicleCategory | null;
  // Passenger seats on the carte grise (S.1 / G field). Drives the Phase 1
  // seat-capacity match.
  seats?: number | null;
}

export interface DriverProfile {
  id: string;
  userId: string;
  isOnline: boolean;
  isVerified: boolean;
  // Service type — which kinds of orders this driver is willing to
  // accept. Free String (not Prisma enum) so the column can be
  // extended without a migration. Admin panel renders a small
  // icon next to the driver name based on this value.
  //   "CARGO" → goods / parcels / furniture
  //   "TAXI"  → passenger transport (Yassir-like)
  //   "BOTH" was RETIRED (2026-09-28): what a driver can serve is now derived
  //   from `vehicleCategory` (taxi_car / taxi_car_7 -> passengers; moto /
  //   tricycle / truck / ... -> cargo) instead of a declared intent that could
  //   contradict the registered vehicle. Rows were migrated in the DB and the
  //   literal is rejected by every write path.
  // Defaults to "CARGO" for every pre-V2 driver.
  serviceType?: 'CARGO' | 'TAXI' | string;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  // Driver self-registration workflow: the driver can be in one of three
  // application states. "active" means approved and on the platform; "pending"
  // means a self-registered driver waiting for admin review; "rejected" means
  // an admin refused the application (the user can re-apply).
  applicationStatus?: 'active' | 'pending' | 'rejected';
  appliedAt?: string | null;
  reviewedAt?: string | null;
  // Live GPS position (Phase 2 driver tracking). Null until the driver has
  // started broadcasting fixes via /api/driver/location. `lastSeenAt` lets
  // the UI distinguish "stale" drivers (online flag on but no fix in a
  // while) from "fresh" ones — used by the admin fleet map to colour the
  // marker and decide if the driver is "live" vs "offline".
  currentLat?: number | null;
  currentLng?: number | null;
  lastSeenAt?: string | null;
  // Carte grise (vehicle registration) data — null if the driver has not
  // submitted one (e.g. admin-created legacy accounts).
  vehicleRegistration?: VehicleRegistrationInfo | null;
  user: AuthUser;
}

// Compact GPS-only projection of a driver, served by
// /api/admin/drivers/locations. Returned *only* for drivers that are
// currently broadcasting (last fix in the last 10 minutes), so the
// admin fleet map can render a marker without re-asking for the full
// profile (name + phone is enough to label the pin).
export interface AdminDriverLocation {
  id: string;
  name: string;
  phone: string;
  avatar: string | null;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  currentLat: number;
  currentLng: number;
  lastSeenAt: string;
  vehicleLabel: string | null;
}

// TRIP OFFERS: lifecycle of a pre-published trip.
export type TripOfferStatus = 'available' | 'booked' | 'cancelled';
// TRIP OFFERS: matches Driver.serviceType (free string on the DB
// side; narrowed here for the API surface). A driver publishes
// either flavour; the value is a per-offer choice, not a per-driver
// one. 'BOTH' is no longer a service type (see DriverProfile above).
export type TripOfferServiceType = 'TAXI' | 'CARGO';

export interface TripOffer {
  id: string;
  driverId: string;
  serviceType: TripOfferServiceType;
  pickup: string;
  dropoff: string;
  scheduledAt: string; // ISO-8601
  price: number;
  // For TAXI: number of seats still available. For CARGO: null.
  seatsAvail: number | null;
  // For CARGO: same vocabulary as Order.cargoType. For TAXI: null.
  cargoType: CargoKey | null;
  status: TripOfferStatus;
  bookerId: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional join shapes the API may include (e.g. on the
  // customer browse view we want the driver name + rating inline
  // so we don't need a second roundtrip).
  driver?: {
    id: string;
    user: AuthUser;
    rating: number;
    totalTrips: number;
    serviceType?: 'CARGO' | 'TAXI' | string;
  } | null;
}

export interface Order {
  id: string;
  code: string;
  customerId: string;
  driverId: string | null;
  cargoType: CargoKey;
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  weight: number;
  distance: number;
  price: number;
  status: OrderStatus;
  notes: string | null;
  rating: number | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  // SCHEDULED BOOKINGS: null = immediate order (the historical default).
  // A future ISO timestamp = the customer reserved a triporteur / taxi
  // for that moment; the server stores status='scheduled' until the
  // dispatcher flips it to 'searching'.
  scheduledAt?: string | null;
  // VEHICLE-TYPE MATCHING (Phase 2): the category the customer required,
  // mirrored from `Order.requiredVehicleType`. Null = no preference.
  // Surfaced in the order card so drivers can see at a glance whether
  // their vehicle matches before accepting.
  requiredVehicleType?: VehicleCategory | null;
  // SEAT-CAPACITY MATCHING (Phase 1): minimum passenger seats the customer
  // asked for (TAXI mode). Null = no requirement, so every pre-Phase-1 row
  // and every CARGO order keeps its exact previous behaviour.
  requiredSeats?: number | null;
  // PRICE NEGOTIATION (Phase 3): the customer is open to drivers
  // proposing a different price (`OrderOffer` rows). False by default,
  // which is what every pre-negotiation order has.
  isNegotiable?: boolean;
  // PRICE NEGOTIATION (Phase 3): the price the customer and the driver
  // actually agreed on. Preferred over `price` for display / earnings
  // once an offer has been accepted; null while still searching or when
  // the order was never negotiable.
  finalPrice?: number | null;
  // CARGO DEDICATED FLOW (Phase 4): bulk of the shipment ('small' /
  // 'medium' / 'large'); drives the moto-compatibility rule. Null on
  // every pre-Phase-4 row and on taxi bookings.
  cargoSize?: CargoSize | null;
  // CARGO DEDICATED FLOW (Phase 4): public URL of the optional photo of
  // the goods, shown to drivers on the request card. Null = no photo.
  cargoImageUrl?: string | null;
  customer?: AuthUser;
  driver?: AuthUser | null;
}

// ---------------------------------------------------------------------------
// PRICE NEGOTIATION (Phase 3)
//
// A driver's counter-offer on a negotiable order. Mirrors the `OrderOffer`
// Prisma model one-to-one. The `status` field is a free string (not a
// union-typed enum) on the wire because the DB column is a free String —
// mirroring how `Order.status` is modelled — but the known states are
// documented on `OrderOfferStatus` below for the API + UI to share.
// ---------------------------------------------------------------------------
export type OrderOfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered';

export interface OrderOffer {
  id: string;
  orderId: string;
  driverId: string;
  price: number;
  status: string;
  // PRICE NEGOTIATION (Phase 3): the price the customer replied with while
  // this offer is "countered". Null for pending/accepted/rejected offers and
  // for rows written before the column existed.
  counterPrice?: number | null;
  createdAt: string;
  // NEGOTIATION ENGINE (Phase 4): when this offer last changed state.
  // Null on rows written before Phase 4, so older clients can ignore it.
  updatedAt?: string | null;
  // Optional inline joins the API may include so the UI can render an
  // offer card without a second roundtrip: the driver's public identity
  // for the customer-facing list, and the parent order's key fields for
  // the driver-facing list.
  driver?: AuthUser;
  // PHASE 6: delivery-only fallback for the driver's display name, populated by
  // the realtime `offer:new` / `offer:update` payloads. The REST list sends the
  // full `driver` join instead, which always wins when present - this exists so
  // a freshly delivered bid can render a name before the (debounced) refetch
  // lands. Never persisted, never sent to the server.
  driverName?: string | null;
  // NEGOTIATION ENGINE (Phase 4): the negotiation journal for this offer,
  // oldest first, when the API includes it (customer negotiation card and
  // the driver's own offer view). Absent = not included by this endpoint.
  events?: OfferEventPublic[];
  order?: Pick<
    Order,
    'id' | 'code' | 'pickup' | 'dropoff' | 'price' | 'cargoType' | 'scheduledAt'
  > | null;
}

// NEGOTIATION ENGINE (Phase 4): one row of the append-only negotiation
// journal (`OfferEvent` in the schema). Rendered as a timeline under each
// offer so the full price conversation survives counters and refreshes.
export interface OfferEventPublic {
  id: string;
  orderId: string;
  offerId: string | null;
  actorId: string;
  type: 'driver_offer' | 'customer_counter' | 'accepted' | 'rejected' | string;
  price: number | null;
  createdAt: string;
}

// i18n label keys for the journal timeline rows (translations: offerEvent*).
export const OFFER_EVENT_LABEL_KEYS: Record<string, string> = {
  driver_offer: 'offerEventDriverOffer',
  customer_counter: 'offerEventCustomerCounter',
  accepted: 'offerEventAccepted',
  rejected: 'offerEventRejected',
};

// Human-readable Arabic / French label for each offer state, used by the
// offer cards. Unknown / future states fall back to the raw value so a
// new status never renders an empty pill in the UI.
export const ORDER_OFFER_STATUS_LABELS: Record<
  string,
  { ar: string; fr: string }
> = {
  pending: { ar: 'قيد الانتظار', fr: 'En attente' },
  accepted: { ar: 'تم القبول', fr: 'Acceptée' },
  rejected: { ar: 'مرفوضة', fr: 'Refusée' },
  countered: { ar: 'عرض مضاد', fr: 'Contre-offre' },
};

export interface PricingConfig {
  id: string;
  basePrice: number;
  perKm: number;
  multipliers: Record<CargoKey, number>;
}

export interface AdminStats {
  totalOrders: number;
  activeDrivers: number;
  totalDrivers: number;
  revenue: number;
  avgDelivery: number;
  pendingOrders: number;
  deliveredOrders: number;
  todayOrders: number;
  ordersByStatus: { status: string; count: number }[];
  revenueByDay: { day: string; revenue: number }[];
  cargoBreakdown: { cargo: string; count: number }[];
}

export interface Location {
  lat: number;
  lng: number;
}


// ---------------------------------------------------------------------------
// HIRFA marketplace (craft) - public-facing shapes served by /api/craft/*.
// Mirror the DTO selects in lib/dto.ts: sensitive artisan fields (contact
// phone, owning user id, exact workshop coords/address) are never returned.
// ---------------------------------------------------------------------------
export interface CraftCategoryPublic {
  id: string;
  nameAr: string;
  nameFr: string | null;
  slug: string;
  sortOrder: number;
}

export interface ArtisanPublic {
  id: string;
  // HIRFA marketplace: the stable public store slug so a product card can
  // link straight to /craft/<slug>. NULL only during the backfill window;
  // callers fall back to the id-based URL via getStoreUrl().
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  totalSales: number;
  area: { nameAr: string; nameFr: string | null } | null;
}

// HIRFA Phase 3: a purchasable SKU of a product (size / colour / material).
// `priceAdjustment` is ADDED to the product price, and may be negative.
export interface ProductVariantPublic {
  id: string;
  nameAr: string;
  nameFr: string | null;
  priceAdjustment: number;
  stock: number;
}

// HIRFA Phase 3: a rung of the graduated (wholesale) price ladder. Buying at
// least `minQuantity` units unlocks `unitPrice` for the whole line.
export interface ProductTierPublic {
  id: string;
  minQuantity: number;
  unitPrice: number;
}

export interface CraftProductPublic {
  id: string;
  nameAr: string;
  nameFr: string | null;
  descriptionAr: string | null;
  descriptionFr: string | null;
  price: number;
  // HIRFA Phase 3: "ابتداءً من / à partir de" — the lowest reachable unit price
  // across variants & tiers. 0 means "no graduated pricing; just show `price`".
  basePrice: number;
  videoUrl: string | null;
  images: string[];
  stock: number;
  isFeatured: boolean;
  isMadeToOrder: boolean;
  createdAt: string;
  category: { id: string; nameAr: string; nameFr: string | null; slug: string };
  artisan: ArtisanPublic;
  variants: ProductVariantPublic[];
  tiers: ProductTierPublic[];
}

export interface CraftProductListResponse {
  products: CraftProductPublic[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// HIRFA (P4): artisan application as seen by the admin review queue.
// `user` carries the public user projection (name/phone/avatar) so the
// reviewer can identify the applicant. Workshop coordinates are never
// exposed here.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// HIRFA (P6): craft order status and public-facing shapes for the cart &
// order-management flows. CraftOrderStatus is a free String in the DB but
// we narrow the union here so the frontend can pattern-match safely.
// ---------------------------------------------------------------------------
export type CraftOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export interface CraftOrderItemPublic {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  // HIRFA Phase 3: the chosen SKU (null = no variants on the product, or the
  // variant was deleted after the order was delivered — onDelete: SetNull).
  variantId: string | null;
  variant: {
    id: string;
    nameAr: string;
    nameFr: string | null;
    priceAdjustment: number;
  } | null;
  product: {
    id: string;
    nameAr: string;
    nameFr: string | null;
    images: string[];
  };
}

/**
 * PHASE 7B — the delivery leg of a marketplace order, as shown to the customer.
 *
 * Mirrors `craftDeliverySelect` in src/lib/dto.ts. `price` / `finalPrice` are
 * DELIVERY money only and are never merged with `CraftOrder.totalPrice`, which
 * stays the product subtotal on the parent row.
 */
export interface CraftDeliveryPublic {
  id: string;
  status: string;
  price: number;
  finalPrice: number | null;
  pickup?: string;
  dropoff?: string;
  /** Display name only — never a phone number, email or coordinate. */
  driver: { name: string } | null;
  acceptedAt: string | null;
  pickedAt: string | null;
  deliveredAt: string | null;
}

export interface CraftOrderPublic {
  id: string;
  code: string;
  status: CraftOrderStatus;
  deliveryOption: string;
  totalPrice: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; name: string; phone: string };
  artisan: { id: string; displayName: string; avatarUrl: string | null };
  items: CraftOrderItemPublic[];
  // PHASE 7B: the linked Wassilha transport Order, or null for a pickup order.
  // Deliberately narrow — the driver's NAME only. No phone, no email and no
  // coordinates ever reach the client through this block.
  delivery?: CraftDeliveryPublic | null;
  review?: {
    id: string;
    score: number;
    comment: string | null;
    // HIRFA Phase 3: photo reviews, the artisan's public reply, and the
    // "helpful" vote count. `from` is the reviewer's public identity.
    images: string[];
    sellerReply: string | null;
    likeCount: number;
    createdAt: string;
    from?: { id: string; name: string | null; avatar: string | null } | null;
  } | null;
}

export interface CraftOrderListResponse {
  orders: CraftOrderPublic[];
  total: number;
}

// HIRFA Phase 2B: the checkout splits a multi-store cart into ONE order per
// store (a CraftOrder has a single artisanId). Single-store checkouts get an
// array of exactly one element — the client treats both cases the same way.
export interface CraftOrderCreateResponse {
  orders: CraftOrderPublic[];
}

export interface CraftArtisanApplication {
  id: string;
  userId: string;
  displayName: string;
  bioAr: string | null;
  bioFr: string | null;
  phone: string | null;
  status: 'pending' | 'rejected';
  appliedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  area: { nameAr: string; nameFr: string | null } | null;
  user: { id: string; name: string; phone: string; avatar: string | null };
}

// ---------------------------------------------------------------------------
// HIRFAA Phase 1 (Marketplace): public store-front shapes (no auth required).
// These mirror the dto.ts selects: NO userId / phone / coords / owner id.
// ---------------------------------------------------------------------------
export interface PublicArtisanTile {
  id: string;
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  totalSales: number;
  productCount: number;
  area: { nameAr: string; nameFr: string | null } | null;
}

export interface PublicStoreFront {
  id: string;
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  bioAr: string | null;
  bioFr: string | null;
  rating: number;
  totalSales: number;
  area: { nameAr: string; nameFr: string | null } | null;
  products: PublicProduct[];
  productCount: number;
}

export interface PublicProduct {
  id: string;
  slug: string | null;
  nameAr: string;
  nameFr: string | null;
  price: number;
  basePrice: number;
  videoUrl: string | null;
  images: string[];
  stock: number;
  isFeatured: boolean;
  isMadeToOrder: boolean;
  createdAt: string;
  category: { id: string; nameAr: string; nameFr: string | null; slug: string | null } | null;
  artisan: PublicArtisanTile;
  variants: ProductVariantPublic[];
  tiers: ProductTierPublic[];
}

// HIRFA Phase 3: one buyer question on a product + the artisan's answer.
// `answer`/`answeredAt` are null until the artisan replies.
export interface ProductQAPublic {
  id: string;
  question: string;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
  // The asker's public identity (name/avatar only — never phone or email).
  user: { id: string; name: string | null; avatar: string | null };
}

// HIRFA Phase 3: a discount code scoped to ONE artisan. `type` is a free
// string in the DB; only 'percent' | 'fixed' are created today.
export type CouponType = 'percent' | 'fixed';

export interface CouponPublic {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount: number;
  usageLimit: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

// HIRFA Phase 3: what /api/craft/coupons/validate previews — the discount the
// buyer WOULD get, without redeeming the coupon.
export interface CouponPreview {
  valid: boolean;
  error?: 'couponNotFound' | 'couponExpired' | 'couponExhausted' | 'couponInvalid' | 'couponInactive';
  code: string;
  type: CouponType | null;
  value: number | null;
  discount: number;
  minOrderAmount: number | null;
}

export interface PublicProductListResponse {
  products: PublicProduct[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  // HIRFA Phase 2A: the API echoes the normalised filters it applied, so a
  // client can render exactly what the server filtered on.
  filters?: {
    q: string;
    category: string;
    area: string;
    priceMin: number | null;
    priceMax: number | null;
    sort: string;
  };
}

export type PublicStoreTile = PublicArtisanTile;

// HIRFAA Phase 1: the logged-in artisan's own store (dashboard "متجري" card).
export interface MyStoreInfo {
  id: string;
  slug: string | null;
  displayName: string;
  // PHASE 9: pending | active | rejected | suspended. Widened from plain
  // `string` to the real union so the dashboard must handle the new state.
  status: StoreStatus;
  avatarUrl: string | null;
  // PHASE 9: present when an admin suspended the store, so the seller sees WHY
  // and WHEN rather than an unexplained dead dashboard.
  suspendedAt: string | null;
  suspensionReason: string | null;
}

// HIRFA Phase 2A: REAL aggregate counts for the seller's own store, straight
// from CraftAnalyticsEvent. A fresh store legitimately sees zeros.
export interface CraftStoreStats {
  storeViews: number;
  productViews: number;
  shares: number;
  copies: number;
}

// HIRFA Phase 2A: a public delivery area tile (search "Area" filter).
export interface CraftAreaPublic {
  id: string;
  nameAr: string;
  nameFr: string | null;
  slug: string;
  sortOrder: number;
}


// ---------------------------------------------------------------------------
// In-app notification center (Phase 1).
//
// `type` is a free String column (no migration to add a new kind) - this union
// is the TS source of truth and MUST stay in sync with the values emitted by
// src/lib/notifications.ts.
// ---------------------------------------------------------------------------
export type NotificationType =
  | 'order'
  | 'craft_order'
  | 'driver_application'
  | 'artisan_application'
  // PHASE 9: marketplace moderation outcomes. ONE type per surface mirrors the
  // existing 'artisan_application' convention (which already covers both the
  // approved and the rejected store outcome) — the concrete result travels in
  // `data.i18n` keys, so no migration is needed to add a new outcome later.
  | 'product_moderation'
  | 'store_moderation'
  | 'system';

// Optional deep-link payload stored alongside a notification. `i18n` holds the
// keys + params that produced title/body, so a future French render can
// re-resolve them client-side with no schema change.
export interface NotificationI18nRef {
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string | number>;
}

export interface NotificationData {
  orderId?: string;
  artisanId?: string;
  productId?: string;
  code?: string;
  i18n?: NotificationI18nRef;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// PHASE 6 - realtime delivery payloads.
//
// DELIVERY shapes only: the `OfferEvent` journal stays the historical source of
// truth and the REST rows stay the authoritative state. Both payloads are
// deliberately small and carry no phone, token, OTP or coordinate - only fields
// the recipient could already read from the REST route that emitted them.
// ---------------------------------------------------------------------------

// `offer:new` / `offer:update` payload. `kind` lets a client toast without
// diffing the previous row; `status` mirrors `OrderOffer.status`.
export interface RealtimeOfferEvent {
  kind: 'new' | 'countered' | 'accepted' | 'rejected';
  offerId: string;
  orderId: string;
  orderCode: string;
  driverId: string;
  driverName: string | null;
  price: number;
  status: string;
  counterPrice: number | null;
  // Emission time (ISO), used as a cheap out-of-order hint: a client that has
  // already applied a newer event for the same offer ignores an older one.
  at: string;
}

// `notification:new` payload - exactly the `notificationSelect` projection,
// delivered on the recipient's own `private-user-<id>` channel.
export interface RealtimeNotificationEvent {
  notification: AppNotification;
}

// One notification row as returned by notificationSelect / the API. Phase 6
// reuses that exact projection for the `notification:new` realtime payload, so
// the live bell and the fetched list can never disagree on the row shape.
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: NotificationData | null;
  isRead: boolean;
  createdAt: string;
}

// GET /api/notifications response. `unreadCount` rides along so the bell badge
// can be rendered from the same request the list came from; `hasMore` enables
// "load more" without a second round trip.
export interface NotificationListResponse {
  notifications: AppNotification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
// ===========================================================================
// PHASE 9 — marketplace moderation & administration (client-facing shapes).
//
// These mirror the Prisma `select`s in src/lib/dto.ts one-to-one. They exist so
// the admin/seller UI is typed against the SAME contract the server enforces,
// and so a change to a projection breaks compilation here instead of silently
// shipping an undefined field to the screen.
// ===========================================================================

/**
 * The moderation vocabulary is NOT declared here: it lives in
 * `./marketplace-moderation`, next to the `as const` arrays it is derived from
 * and the transition rules the API enforces.
 *
 * Re-exporting (instead of hand-copying the unions) is what stops the two from
 * drifting — adding a status to `PRODUCT_MODERATION_STATUSES` automatically
 * updates the type every component sees, and a forgotten union can no longer
 * silently disagree with the server's transition table.
 */
import type {
  ProductModerationStatus,
  ModerationAction,
  ArtisanStatus as StoreStatus,
  ReportTargetType,
  ReportReason,
  ReportStatus,
  ReportResolutionStatus,
} from './marketplace-moderation';

export type {
  ProductModerationStatus,
  ModerationAction,
  StoreStatus,
  ReportTargetType,
  ReportReason,
  ReportStatus,
  ReportResolutionStatus,
};

/** A seller-owned product row, as the seller dashboard and admin queue see it. */
export interface SellerProduct {
  id: string;
  slug: string | null;
  artisanId: string;
  categoryId: string;
  nameAr: string;
  nameFr: string | null;
  descriptionAr: string | null;
  descriptionFr: string | null;
  price: number;
  basePrice: number;
  videoUrl: string | null;
  images: string[];
  stock: number;
  isFeatured: boolean;
  isMadeToOrder: boolean;
  /** The seller's own visibility toggle (distinct from moderation state). */
  isActive: boolean;
  /** ADMIN-owned review state. */
  moderationStatus: ProductModerationStatus;
  /** Why the admin rejected/suspended it (null when never acted on). */
  moderationReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
  category: { id: string; nameAr: string; nameFr: string | null; slug: string | null } | null;
  artisan: { id: string; displayName: string; slug: string | null; avatarUrl: string | null; rating: number; totalSales: number };
  // The seller projection spreads `publicCraftProductSelect`, so it DOES carry
  // the purchasable SKUs and the price ladder. Declared here because the seller
  // edit form needs them and the type would otherwise be missing two fields
  // that the API actually returns.
  variants: ProductVariantPublic[];
  tiers: ProductTierPublic[];
}

/** One store/seller row in the admin marketplace → Stores screen. */
export interface AdminMarketplaceStore {
  id: string;
  userId: string;
  displayName: string;
  slug: string | null;
  status: StoreStatus;
  phone: string | null;
  rating: number;
  totalSales: number;
  appliedAt: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  area: { nameAr: string; nameFr: string | null } | null;
  user: { id: string; phone: string; name: string; role: string; avatar: string | null };
}

/** One report in the admin queue. */
export interface AdminMarketplaceReport {
  id: string;
  targetType: 'product' | 'store';
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  reporter: { id: string; phone: string; name: string; role: string; avatar: string | null };
  resolvedBy: { id: string; name: string } | null;
  product: {
    id: string;
    nameAr: string;
    nameFr: string | null;
    slug: string | null;
    moderationStatus: ProductModerationStatus;
    artisan: { id: string; displayName: string; slug: string | null; status: StoreStatus };
  } | null;
  artisan: { id: string; displayName: string; slug: string | null; status: StoreStatus } | null;
}

/**
 * An admin view of a CraftOrder.
 *
 * PRICE SEPARATION (must survive every refactor): `totalPrice` is the PRODUCT
 * subtotal after coupon; the delivery fee is `delivery.price|finalPrice`. They
 * are never summed — the UI shows two labelled figures.
 */
export interface AdminMarketplaceOrder {
  id: string;
  code: string;
  status: CraftOrderStatus;
  deliveryOption: 'pickup' | 'wassilha_delivery';
  totalPrice: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; name: string; phone: string };
  artisan: { id: string; displayName: string; slug: string | null; status: StoreStatus };
  items: {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    variantId: string | null;
    product: { id: string; nameAr: string; nameFr: string | null; images: string[] };
  }[];
  deliveryOrder: {
    id: string;
    status: string;
    price: number;
    finalPrice: number | null;
    pickup: string;
    dropoff: string;
    driver: { name: string } | null;
    acceptedAt: string | null;
    pickedAt: string | null;
    deliveredAt: string | null;
  } | null;
}

// PHASE 10 — server-side cart / favourites (dual-write mirror).
// The GET payload mirrors the LOCAL cart line shape exactly so the client
// merge can treat both sides interchangeably. `price` here is a DISPLAY
// preview hydrated server-side from CraftProduct (+ variant adjustment);
// checkout still recomputes every number from the DB, as before.
export interface CraftCartServerLine {
  productId: string;
  variantId: string | null;
  nameAr: string;
  price: number;
  image: string | null;
  qty: number;
}

export interface CraftCartServer {
  items: CraftCartServerLine[];
  couponCode: string | null;
}

// Favourites sync returns BARE product ids only — never a product payload,
// so it can never surface a moderated (hidden) product's data.
export interface FavoritesSync {
  productIds: string[];
}