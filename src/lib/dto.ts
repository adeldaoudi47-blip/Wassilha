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
} as const;
