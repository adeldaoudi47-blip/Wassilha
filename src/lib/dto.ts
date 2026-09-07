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
// HIRFA (craft) - public projections. Artisan contact phone, owning user id
// and exact workshop coords/address are intentionally excluded: customers
// see the neighbourhood (area name) only.
// ---------------------------------------------------------------------------
export const publicArtisanSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  rating: true,
  totalSales: true,
  area: { select: { nameAr: true, nameFr: true } },
} as const;

export const publicCraftProductSelect = {
  id: true,
  nameAr: true,
  nameFr: true,
  descriptionAr: true,
  descriptionFr: true,
  price: true,
  images: true,
  stock: true,
  isFeatured: true,
  createdAt: true,
  category: { select: { id: true, nameAr: true, nameFr: true, slug: true } },
  artisan: { select: publicArtisanSelect },
} as const;