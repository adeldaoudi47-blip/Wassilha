// -----------------------------------------------------------------------------
// DTO helpers — strip sensitive User fields before serializing to the client.
//
// SECURITY: never return a Prisma `User` row directly from an API route.
// Forgetting the `select` (and falling back to `include: { customer: true,
// driver: true }`) leaks `passwordHash` (scrypt hash), `email`,
// `phoneVerified`, and `accountStatus` to whoever holds a valid session.
//
// Apply to every Prisma query that selects a User — relations, joins, owners.
// -----------------------------------------------------------------------------

const PUBLIC_USER_FIELDS = ['id', 'phone', 'name', 'role', 'avatar'] as const;

export type PublicUser = {
  id: string;
  phone: string;
  name: string;
  role: string;
  avatar: string | null;
};

/**
 * Map a Prisma `User` row (or any object carrying User fields) to the
 * public-facing shape. Strips `passwordHash`, `email`, `phoneVerified`,
 * `accountStatus`, `createdAt`, `updatedAt`, plus every relation.
 *
 * The `T` generic preserves any extra top-level columns the caller picked
 * via `select` (e.g. `phone` if the caller wanted to keep it for the
 * driver's own profile but strip it from other people's profiles).
 *
 * For guaranteed safety, use Prisma's `select` at the query level AND
 * apply this helper to relations. Defense in depth: if a future query
 * forgets `select`, the `passwordHash` is still absent from the JSON
 * response (Prisma always includes it when using `include: { ... true }`).
 */
export function toUserPublic<T extends Record<string, unknown>>(
  u: T
): PublicUser {
  return {
    id: String(u.id ?? ''),
    phone: String(u.phone ?? ''),
    name: String(u.name ?? ''),
    role: String(u.role ?? 'customer'),
    avatar: (u.avatar as string | null | undefined) ?? null,
  };
}

/**
 * Build a `select` clause that returns ONLY the public User fields.
 * Use this in Prisma queries to avoid the entire `include: { ... true }`
 * footgun:
 *
 *   const order = await db.order.findUnique({
 *     where: { id },
 *     select: { ...orderFields, customer: { select: publicUserSelect } },
 *   });
 */
export const publicUserSelect = {
  id: true,
  phone: true,
  name: true,
  role: true,
  avatar: true,
} as const;

/**
 * The list of Order columns that are safe to return to any authenticated
 * party (customer, driver, admin). Does NOT include `customerId`/`driverId`
 * are obviously safe to expose but we keep them as the relations cover them.
 */
export const publicOrderSelect = {
  id: true,
  code: true,
  customerId: true,
  driverId: true,
  cargoType: true,
  pickup: true,
  dropoff: true,
  pickupLat: true,
  pickupLng: true,
  dropoffLat: true,
  dropoffLng: true,
  weight: true,
  distance: true,
  price: true,
  status: true,
  notes: true,
  rating: true,
  createdAt: true,
  acceptedAt: true,
  pickedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  // SCHEDULED BOOKINGS: ISO timestamp for future reservations, null
  // for immediate orders. The frontend (customer track + driver
  // requests) reads this to render the booking time.
  scheduledAt: true,
  // VEHICLE-TYPE MATCHING (Phase 2): the category the customer required
  // (or null). Returned to drivers so they can tell whether their
  // vehicle fits before accepting, and to the customer in track view.
  requiredVehicleType: true,
  // MULTI-SELECT VEHICLE TYPES: the official categories the customer picked
  // for this order (empty array = no preference). Returned to drivers so they
  // can tell whether their vehicle fits before accepting.
  requiredVehicleTypes: true,
  // SEAT-CAPACITY MATCHING (Phase 1): the minimum passenger seats the
  // customer asked for (TAXI), null when unspecified. Returned to drivers
  // so a vehicle with too few seats never appears in their list.
  requiredSeats: true,
  // PRICE NEGOTIATION (Phase 3): the negotiability flag drives the
  // "make an offer" affordance on the driver side and the "offers
  // received" badge on the customer side. Defaulted by the DB so old
  // rows still serialise as false.
  isNegotiable: true,
  // PRICE NEGOTIATION (Phase 3): the agreed price, null while the order
  // is still open or was never negotiable. UI reads this in preference
  // to `price` when it is set.
  finalPrice: true,
  // CARGO DEDICATED FLOW (Phase 4): bulk of the shipment (drives the
  // moto-compatibility display / badge) and the optional photo of the
  // goods drivers see on the request card. Null on legacy rows.
  cargoSize: true,
  cargoImageUrl: true,
} as const;

/**
 * PRICE NEGOTIATION (Phase 3) — the columns of an `OrderOffer` row that
 * are safe to return to any authenticated party.
 *
 * `driverId` is exposed on purpose (same posture as `publicOrderSelect`:
 * ids are not secret, the relations are what carry the sensitive columns).
 * The driver's *identity* is joined through `publicUserSelect` so the
 * customer's offer list can show a name + avatar without a second call.
 */
export const orderOfferSelect = {
  id: true,
  orderId: true,
  driverId: true,
  price: true,
  status: true,
  // PRICE NEGOTIATION (Phase 3): the customer's counter-price, present only
  // while status = "countered". Nullable, so every older row / state still
  // deserialises as null.
  counterPrice: true,
  createdAt: true,
  // NEGOTIATION ENGINE (Phase 4): last state change. Nullable column, so
  // rows written before Phase 4 serialise as null.
  updatedAt: true,
} as const;

/**
 * NEGOTIATION ENGINE (Phase 4) — columns of an `OfferEvent` journal row
 * that are safe to return to the negotiation participants (order owner +
 * offering driver). `actorId` is an id only, never joined to a User, so
 * no extra personal data leaks through the timeline.
 */
export const offerEventSelect = {
  id: true,
  orderId: true,
  offerId: true,
  actorId: true,
  type: true,
  price: true,
  createdAt: true,
} as const;

/**
 * TRIP OFFERS: the list of TripOffer columns that are safe to return
 * to any authenticated party (driver owner, customer, admin).
 *
 * `bookerId` and `orderId` are exposed on purpose so the UI can
 * tell the driver "this offer is booked by user X" without a
 * follow-up call. The booker is resolved server-side only.
 *
 * Driver relation is intentionally NOT included here — the
 * `browse` endpoint inlines a curated driver shape (id, user
 * public fields, rating, totalTrips, serviceType) via
 * `withDriverForBrowse` below.
 */
export const publicTripOfferSelect = {
  id: true,
  driverId: true,
  serviceType: true,
  pickup: true,
  dropoff: true,
  scheduledAt: true,
  price: true,
  seatsAvail: true,
  cargoType: true,
  status: true,
  bookerId: true,
  orderId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * TRIP OFFERS: a slim driver projection for the customer browse
 * feed. Picks only safe + useful fields (no email, no
 * passwordHash, no phone — phone is leaked only on the driver's
 * own profile screen).
 */
export const tripOfferDriverSelect = {
  id: true,
  rating: true,
  totalTrips: true,
  serviceType: true,
  user: { select: publicUserSelect },
} as const;


// ---------------------------------------------------------------------------
// HIRFA marketplace (craft) - public projections. Artisan contact phone, owning user id
// and exact workshop coords/address are intentionally excluded: customers
// see the neighbourhood (area name) only.
//
// HIRFAA Phase 1: added craftCategorySelect — the category taxonomy projection
// used by the PUBLIC marketplace/storefront. Mirrors the fields already exposed
// by the existing CraftCategory model (id/nameAr/nameFr/slug/sortOrder).
// ---------------------------------------------------------------------------
export const craftCategorySelect = {
  id: true,
  nameAr: true,
  nameFr: true,
  slug: true,
  sortOrder: true,
} as const;
export const publicArtisanSelect = {
  id: true,
  slug: true,
  displayName: true,
  avatarUrl: true,
  rating: true,
  totalSales: true,
  area: { select: { nameAr: true, nameFr: true } },
} as const;

// ---------------------------------------------------------------------------
// HIRFA (P6): public projections for craft orders. The customer's phone is
// included so the artisan can contact them; the artisan phone is NOT
// included (the artisan already knows their own contact).
// ---------------------------------------------------------------------------
export const publicCraftOrderItemSelect = {
  id: true,
  productId: true,
  quantity: true,
  unitPrice: true,
  // HIRFA Phase 3: the variant the customer bought, when the product has any.
  variantId: true,
  variant: { select: { id: true, nameAr: true, nameFr: true, priceAdjustment: true } },
  product: {
    select: {
      id: true,
      nameAr: true,
      nameFr: true,
      images: true,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// PHASE 7B — marketplace delivery tracking projection.
//
// Deliberately NARROW: the delivery's own state plus the driver's display name.
//
// Never included: `driver.phone`, `driver.email`, any coordinate column, or any
// other internal column. The customer could already read the assigned driver's
// name and avatar from the transport order, so nothing here widens exposure.
// A driver with no assignment yields `driver: null`, which the UI renders as
// "looking for a driver".
//
// Declared BEFORE `publicCraftOrderSelect` because that projection embeds it
// and `const` bindings are not hoisted.
// ---------------------------------------------------------------------------
export const craftDeliverySelect = {
  id: true,
  status: true,
  // DELIVERY money only. `CraftOrder.totalPrice` (the product subtotal) stays a
  // separate field on the parent row and is deliberately never merged here:
  // driver earnings are `finalPrice ?? price`, i.e. the delivery fee alone.
  price: true,
  finalPrice: true,
  pickup: true,
  dropoff: true,
  // Display name ONLY — deliberately not publicUserSelect, which carries `phone`
  // and `role`.
  driver: { select: { name: true } },
  acceptedAt: true,
  pickedAt: true,
  deliveredAt: true,
} as const;

/**
 * The same projection WITHOUT the two addresses, for the SELLER view.
 *
 * Phase 7A deliberately keeps the customer's dropoff off `CraftOrder` so a seller
 * can never read their buyer's home address. Nesting the full block into the
 * shared projection would hand that address to every shop the customer has
 * ordered from — so the artisan branch of GET /api/craft/orders swaps in this
 * redacted shape instead. The seller still sees that a delivery exists, how far
 * along it is, and who is carrying it.
 */
export const craftDeliverySelectNoAddress = {
  id: true,
  status: true,
  price: true,
  finalPrice: true,
  driver: { select: { name: true } },
  acceptedAt: true,
  pickedAt: true,
  deliveredAt: true,
} as const;

export const publicCraftOrderSelect = {
  id: true,
  code: true,
  status: true,
  deliveryOption: true,
  // PHASE 7A: the linked Wassilha transport Order, when delivery was chosen.
  // Exposed so the customer can follow the delivery; it is the CUSTOMER's own
  // order id, not seller data, and the address itself lives on the transport
  // Order under the existing Phase 5 privacy rules.
  deliveryOrderId: true,
  totalPrice: true,
  notes: true,
  createdAt: true,
  confirmedAt: true,
  readyAt: true,
  deliveredAt: true,
  cancelledAt: true,
  customer: { select: { id: true, name: true, phone: true } },
  artisan: { select: { id: true, displayName: true, avatarUrl: true } },
  items: { select: publicCraftOrderItemSelect },
  review: {
    select: {
      id: true,
      score: true,
      comment: true,
      // HIRFA Phase 3: photo reviews + the artisan's public reply + helpful votes.
      images: true,
      sellerReply: true,
      likeCount: true,
      createdAt: true,
      // The reviewer's public identity. Deliberately NARROWER than
      // publicUserSelect: a review is public, so a reader must never see the
      // reviewer's phone number or account role — only name + avatar.
      from: { select: { id: true, name: true, avatar: true } },
    },
  },
  // PHASE 7B: the linked Wassilha transport Order, so a marketplace order can
  // show its real delivery state. `null` for `deliveryOption = 'pickup'`, which
  // leaves that flow byte-identical. Resolved as ONE extra join on the query
  // that already exists — no second request, no N+1.
  //
  // `deliveryOrder` is Prisma's relation name on CraftOrder; `aliasDelivery()`
  // below renames the key to `delivery` in the JSON the client receives.
  deliveryOrder: { select: craftDeliverySelect },
} as const;

/**
 * Rename Prisma's `deliveryOrder` relation key to the public `delivery` key, so
 * the wire format reads `order.delivery.status` while the query stays valid
 * Prisma. Pure and non-destructive: every other field passes through untouched,
 * and a pickup order simply yields `delivery: null`.
 *
 * Applied at every response site returning `publicCraftOrderSelect` rows, so
 * checkout, status transitions and the list endpoint all agree.
 */
export function aliasDelivery<T extends { deliveryOrder?: unknown }>(
  row: T,
): Omit<T, 'deliveryOrder'> & { delivery: unknown } {
  const { deliveryOrder, ...rest } = row;
  return { ...rest, delivery: deliveryOrder ?? null } as Omit<T, 'deliveryOrder'> & {
    delivery: unknown;
  };
}

/** Map a list of rows through `aliasDelivery`. */
export function aliasDeliveries<T extends { deliveryOrder?: unknown }>(
  rows: T[],
): (Omit<T, 'deliveryOrder'> & { delivery: unknown })[] {
  return rows.map(aliasDelivery);
}


// ---------------------------------------------------------------------------
// HIRFA (P3): public projection for craft products. The artisan contact
// phone, owning user id and exact workshop coords are never returned.
// ---------------------------------------------------------------------------
export const publicCraftProductSelect = {
  id: true,
  nameAr: true,
  nameFr: true,
  descriptionAr: true,
  descriptionFr: true,
  price: true,
  // HIRFA Phase 3: the "from" price (0 = no graduated pricing, UI shows `price`).
  basePrice: true,
  // HIRFA Phase 3: optional product video shown on the detail page.
  videoUrl: true,
  images: true,
  stock: true,
  isFeatured: true,
  isMadeToOrder: true,
  createdAt: true,
    category: { select: { id: true, nameAr: true, nameFr: true, slug: true } },
  artisan: { select: publicArtisanSelect },
  // HIRFA Phase 3: the purchasable SKUs and the wholesale price ladder. Both
  // are public (a buyer needs them to choose + to see the price), and neither
  // leaks anything about the artisan's account.
  variants: {
    select: { id: true, nameAr: true, nameFr: true, priceAdjustment: true, stock: true },
    orderBy: { createdAt: 'asc' },
  },
  tiers: {
    select: { id: true, minQuantity: true, unitPrice: true },
    orderBy: { minQuantity: 'asc' },
  },
} as const;

// ---------------------------------------------------------------------------
// HIRFAA Phase 1 (Marketplace): public projections for the store-front.
// Reuses the existing privacy posture of publicArtisanSelect/publicCraftProductSelect:
// NEVER returns userId, artisan phone, exact coordinates, or owner id.
// bioAr/bioFr are marketing text (collected at apply-time) and are safe to expose.
// ---------------------------------------------------------------------------
export const publicArtisanStoreSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  bioAr: true,
  bioFr: true,
  slug: true,
  rating: true,
  totalSales: true,
  area: { select: { nameAr: true, nameFr: true } },
} as const;

// A product tile as surfaced on the public store-front / marketplace.
// Same fields as publicCraftProductSelect PLUS the public slugs needed for
// clean URLs + store attribution without leaking PII.
export const marketplaceProductSelect = {
  id: true,
  slug: true,
  nameAr: true,
  nameFr: true,
  price: true,
  // HIRFA Phase 3: graduated pricing for the public store-front product page.
  basePrice: true,
  videoUrl: true,
  images: true,
  stock: true,
  isFeatured: true,
  isMadeToOrder: true,
  createdAt: true,
  category: { select: { id: true, nameAr: true, nameFr: true, slug: true } },
  artisan: {
    select: {
      id: true,
      slug: true,
      displayName: true,
      avatarUrl: true,
      rating: true,
      totalSales: true,
      area: { select: { nameAr: true, nameFr: true } },
    },
  },
  // HIRFA Phase 3: the same public variant/tier data the in-app detail page
  // gets, so the SSR store page can render choices + the price ladder too.
  variants: {
    select: { id: true, nameAr: true, nameFr: true, priceAdjustment: true, stock: true },
    orderBy: { createdAt: 'asc' },
  },
  tiers: {
    select: { id: true, minQuantity: true, unitPrice: true },
    orderBy: { minQuantity: 'asc' },
  },
} as const;
// ---------------------------------------------------------------------------
// In-app notification center (Phase 1).
//
// Deliberately leaks NO user relation: the API routes scope every query by
// session.id, so returning the owner's own row is pointless - and if this
// select were ever joined to `user`, one mistake would serialize someone
// else's account. `data` is the deep-link payload (+ optional i18n keys) and
// is safe to return verbatim.
// ---------------------------------------------------------------------------
export const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  isRead: true,
  createdAt: true,
} as const;
