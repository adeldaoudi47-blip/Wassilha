# Task 3 — Backend API subagent

## Task
Build ALL Next.js 16 App Router API routes for the WASSILHA triporteur delivery platform (El Guerrara, Ghardaïa).

## Files Created (22 route files)

### Auth (`src/app/api/auth/`)
- `send-otp/route.ts` — POST {phone}; validates `^0[567]\d{8}$`; returns `{ok, devOtp:'0000'}`.
- `verify-otp/route.ts` — POST {phone, code, name?}; finds-or-creates user (role customer); sets session; returns `{user: AuthUser}`.
- `login-as/route.ts` — POST {role}; uses DEMO_ACCOUNTS; creates Driver profile on first driver demo login; sets session; returns `{user}`.
- `me/route.ts` — GET; returns `{user: AuthUser | null}`.
- `logout/route.ts` — POST; clearSession; returns `{ok:true}`.

### Pricing (`src/app/api/pricing/route.ts`)
- GET — parses `multipliers` JSON string → `Record<CargoKey, number>`; seeds default if missing.
- PUT — admin-only; merges partial multipliers with defaults; upserts to `id='default'`.

### Orders (`src/app/api/orders/`)
- `route.ts` — POST (customer/admin create with `generateOrderCode()`, status='searching'); GET filters by role + status, includes customer/driver, sorted desc.
- `[id]/route.ts` — GET single with relations; 404 if missing.
- `[id]/accept/route.ts` — POST (driver only); sets driverId, status='accepted', acceptedAt.
- `[id]/reject/route.ts` — POST (driver); no-op returns `{ok:true}`.
- `[id]/pickup/route.ts` — POST (driver); status='picked', pickedAt.
- `[id]/deliver/route.ts` — POST (driver); status='delivered', deliveredAt; increments driver.totalTrips/totalEarnings; recomputes rating.
- `[id]/cancel/route.ts` — POST (customer owner OR assigned driver OR admin); status='cancelled', cancelledAt.
- `[id]/rate/route.ts` — POST (customer owner, status delivered); creates Rating record; recomputes driver.rating avg.

### Driver (`src/app/api/driver/`)
- `profile/route.ts` — GET; shapes `DriverProfile`.
- `status/route.ts` — PATCH {isOnline}; returns full DriverProfile.
- `earnings/route.ts` — GET; returns `{total, thisWeek, trips, rating, recent: Order[], weekly: {day,earnings}[]}` (7-day breakdown).
- `incoming/route.ts` — GET; orders with status='searching', sorted asc.

### Admin (`src/app/api/admin/`)
- `stats/route.ts` — GET (admin only); full AdminStats with groupBy aggregations.
- `drivers/route.ts` — GET list of DriverProfile[]; POST create with cascading User+Driver+Vehicle.
- `orders/route.ts` — GET all orders with relations sorted desc.
- `drivers/[id]/route.ts` — PATCH {isVerified?, isOnline?}.

## Key Decisions
- All dynamic routes use Next.js 16 signature: `(req, { params }: { params: Promise<{ id: string }> })` with `const { id } = await params;` inside.
- All handlers wrapped in try/catch; errors returned as `NextResponse.json({error, detail}, {status})`.
- Auth-protected routes call `getSession()`; role checks return 401 (no session) or 403 (wrong role).
- Prisma `include: { customer: true, driver: true }` ensures Order objects match the `Order` type with optional `customer`/`driver` fields.
- Pricing.multipliers: JSON.parse on read, JSON.stringify on write, merged with defaults to keep all 8 cargo keys.
- Driver aggregates auto-updated on deliver (totalTrips +1, totalEarnings += price) and on rate (rating = avg of all Rating records for that driver).
- `login-as` driver role auto-creates a Driver profile if missing, so the demo driver flow works without admin onboarding.

## Testing
Live-tested via curl through cookie sessions:
- Full order lifecycle (accept → pickup → deliver → rate) ✓
- 401 for unauthenticated ✓
- 403 for wrong-role (customer PUT /api/pricing forbidden; admin allowed) ✓
- 404 for missing orders ✓
- 400 for bad phone / bad OTP code ✓
- Admin stats returns correct aggregations from seed data ✓
- Driver earnings weekly breakdown computed correctly ✓

Dev server log shows no compile errors. All 22 routes respond with proper status codes matching the API contract in `src/lib/api.ts`.
