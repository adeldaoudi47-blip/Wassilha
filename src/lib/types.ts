// WASSILHA shared types

export type Role = 'customer' | 'driver' | 'admin';
export type Lang = 'ar' | 'fr';
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
  | 'taxi';
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
  //   "BOTH"  → accepts both kinds of orders
  // Defaults to "CARGO" for every pre-V2 driver.
  serviceType?: 'CARGO' | 'TAXI' | 'BOTH' | string;
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
// side; narrowed here for the API surface). Old 'BOTH' drivers
// can still publish either flavour — the value is a per-offer
// choice, not a per-driver one.
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
    serviceType?: 'CARGO' | 'TAXI' | 'BOTH' | string;
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
  customer?: AuthUser;
  driver?: AuthUser | null;
}

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
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  totalSales: number;
  area: { nameAr: string; nameFr: string | null } | null;
}

export interface CraftProductPublic {
  id: string;
  nameAr: string;
  nameFr: string | null;
  descriptionAr: string | null;
  descriptionFr: string | null;
  price: number;
  images: string[];
  stock: number;
  isFeatured: boolean;
  createdAt: string;
  category: { id: string; nameAr: string; nameFr: string | null; slug: string };
  artisan: ArtisanPublic;
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