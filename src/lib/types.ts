// WASSILHA shared types

export type Role = 'customer' | 'driver' | 'admin' | 'artisan';
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
  | 'taxi'
  // `craft` is the Hirfa handmade delivery type. Orders with this
  // cargoType are delivery tasks for artisan products. The DB column
  // is a free String so no migration is needed.
  | 'craft';
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
  status: string;
  avatarUrl: string | null;
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

// One notification row as returned by notificationSelect / the API.
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