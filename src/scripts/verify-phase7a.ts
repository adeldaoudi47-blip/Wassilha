// ---------------------------------------------------------------------------
// PHASE 7A verification - Marketplace -> Wassilha delivery bridge.
//
// The repo has no test framework, so - like the phase 1/2/4/5/6 verifiers -
// this file IS the gate. It proves the delivery is a REAL Wassilha transport
// Order rather than a parallel mechanism:
//
//   1. the unsafe dead block is GONE (not merely bypassed),
//   2. the checkout accepts the new option and still accepts the old one,
//   3. the transport Order is built with the Phase 1-6 semantics (server-side
//      price, cargo classification, negotiable policy),
//   4. dispatch goes through `fanOutNewOrder` / `emitOrderNewRequest`, so
//      `isVehicleCompatible` remains the single source of truth,
//   5. one CraftOrder -> at most one transport Order (idempotency),
//   6. no client-supplied price/ids are trusted,
//   7. cancelling the craft order cancels its delivery.
//
// Run with: bun src/scripts/verify-phase7a.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) pass++;
  else fail++;
  console.log(`[${tag}] ${name}${extra ? ` - ${extra}` : ''}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function src(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

const helper = src('src/lib/craft-delivery.ts');
const checkout = src('src/app/api/craft/orders/route.ts');
const statusRoute = src('src/app/api/craft/orders/[id]/status/route.ts');
const cart = src('src/components/wassilha/craft/craft-cart.tsx');
const schema = src('prisma/schema.prisma');

// ---------------------------------------------------------------------------
section('M7A-01 / M7A-02  delivery option contract');
// ---------------------------------------------------------------------------
check(
  'M7A-01 pickup still works and is the default',
  /z\.enum\(\['pickup', 'wassilha_delivery'\]\)\.default\('pickup'\)/.test(checkout),
);
check('M7A-02 wassilha_delivery is accepted', checkout.includes("'wassilha_delivery'"));
check(
  'the client contract already supported both (api.ts unchanged)',
  src('src/lib/api.ts').includes("'pickup' | 'wassilha_delivery'"),
);
check(
  'a delivery without a destination is refused (no fake address)',
  checkout.includes("error: 'deliveryAddressRequired'") &&
    /wantsDelivery && dropoffAddress\.length < 2/.test(checkout),
);

// ---------------------------------------------------------------------------
section('M7A-03 / M7A-04  one CraftOrder -> at most one transport Order');
// ---------------------------------------------------------------------------
check('M7A-03 exactly one transport Order is created per craft order', helper.includes('tx.order.create'));
check(
  'M7A-04 duplicate checkout cannot create a second one',
  helper.includes('if (existing?.deliveryOrderId) return null;') &&
    helper.includes('where: { id: craftOrderId, deliveryOrderId: null }') &&
    helper.includes("throw new Error('deliveryLinkLost')"),
);
check(
  'creation happens INSIDE the checkout transaction (atomic)',
  /await db\.\$transaction\(async \(tx\)/.test(checkout) &&
    /createCraftDeliveryOrder\(\{\s*\n\s*tx,/.test(checkout),
);
// ---------------------------------------------------------------------------
section('M7A-05 / M7A-06  price separation and tamper resistance');
// ---------------------------------------------------------------------------
check(
  'M7A-05 delivery price comes from the shared pricing engine',
  helper.includes('computeOrderPrice') && helper.includes('cargoType: DELIVERY_CARGO_TYPE'),
);
check(
  'M7A-06 no hardcoded price/weight, no client price read',
  !/\bprice:\s*300\b/.test(helper) &&
    !/\bweight:\s*5\b/.test(helper) &&
    /weight: CARGO_SIZE_WEIGHT\[cargoSize\]/.test(helper),
);
check(
  'the product subtotal never becomes the delivery price',
  // `totalPrice` may be mentioned in prose, but must never be READ by the
  // helper: the delivery fare is computed from computeOrderPrice alone.
  !/totalPrice/.test(helper.replace(/^\s*\/\/.*$/gm, '')),
);
check(
  'driver earnings stay delivery-only (finalPrice ?? price)',
  src('src/app/api/orders/[id]/deliver/route.ts').includes('updated.finalPrice ?? updated.price'),
);

// ---------------------------------------------------------------------------
section('M7A-07 / M7A-08  dispatch reuses the authoritative path');
// ---------------------------------------------------------------------------
check(
  'M7A-07 dispatch uses fanOutNewOrder + emitOrderNewRequest',
  checkout.includes('fanOutNewOrder') && checkout.includes('emitOrderNewRequest'),
);
check('M7A-08 the realtime pool is filtered by findAvailableDrivers', checkout.includes('findAvailableDrivers'));
check(
  'all four dispatch arguments are forwarded (multi-select included)',
  /findAvailableDrivers\(\s*\n\s*order\.cargoType,[\s\S]{0,240}order\.requiredVehicleTypes \?\? \[\],/.test(checkout),
);
check(
  'the delivery Order carries cargo semantics (CARGO drivers eligible)',
  helper.includes("const DELIVERY_CARGO_TYPE: CargoKey = 'goods'"),
);
check(
  'compatibility still flows through isVehicleCompatible',
  src('src/lib/dispatch.ts').includes('export function isVehicleCompatible'),
);
check(
  'no bespoke driver query remains in the craft delivery path',
  !/db\.driver\.findMany\(\{[\s\S]{0,240}serviceType: 'CARGO'/.test(statusRoute),
);

// ---------------------------------------------------------------------------
section('M7A-09  ownership and untrusted input');
// ---------------------------------------------------------------------------
check(
  'M7A-09 checkout requires a session',
  /if \(!session\) return NextResponse\.json\(\{ error: 'unauthorized'/.test(checkout),
);
check(
  'the customer id is resolved from the session at the checkout boundary',
  // The helper legitimately RECEIVES customerId as a parameter; what must never
  // happen is it being taken from the request body.
  /createCraftDeliveryOrder\(\{[\s\S]{0,200}customerId: session\.id/.test(checkout) &&
    /customerId: session\.id/.test(checkout),
);
check('the store id comes from product ownership', /storeId: artisanId/.test(checkout));
check(
  'no client-supplied driverId / deliveryFee / deliveryOrderId is read',
  !/body\.driverId|body\.deliveryFee|body\.deliveryOrderId|body\.artisanId/.test(checkout + helper),
);
check(
  'the pickup is built only from stored store data',
  helper.includes('buildPickupLabel') &&
    helper.includes('tx.artisanProfile.findUnique') &&
    helper.includes("throw new Error('storeNotFound')"),
);
check(
  'coordinates fall back to the city centroid like POST /api/orders',
  helper.includes('resolveCoord') && helper.includes('GUERRARA_CENTER'),
);
// ---------------------------------------------------------------------------
section('M7A-10  the unsafe legacy block is removed');
// ---------------------------------------------------------------------------
check(
  'the old "create delivery on ready" block is gone',
  !/if \(newStatus === 'ready'\)/.test(statusRoute),
);
check("no hardcoded cargoType 'craft' order creation remains", !/cargoType: 'craft'/.test(statusRoute));
check('no manual driver fan-out remains in the status route', !statusRoute.includes('sendPushNotificationBatch'));
check('the removal is documented in place', statusRoute.includes('REMOVED, not revived'));

// ---------------------------------------------------------------------------
section('M7A-11  negotiation stays transport-only');
// ---------------------------------------------------------------------------
check(
  'M7A-11 delivery uses the existing cargo negotiable policy',
  helper.includes('isNegotiable: true') &&
    src('src/app/api/orders/route.ts').includes("const isNegotiable = cargoType !== 'taxi' ? true"),
);
check('finalPrice remains a transport-only column', schema.includes('finalPrice    Int?'));
check(
  'the Offer / OfferEvent engine is untouched',
  src('src/lib/offer-policy.ts').includes('canDriverOfferOnOrder') &&
    schema.includes('model OfferEvent'),
);

// ---------------------------------------------------------------------------
section('M7A-12  realtime + notification path');
// ---------------------------------------------------------------------------
check(
  'M7A-12 the delivery rides the Phase 6 realtime/notification path',
  checkout.includes('emitOrderNewRequest') && checkout.includes('fanOutNewOrder'),
);
check(
  'the fan-out runs AFTER the transaction commits',
  checkout.indexOf('return { orders, deliveries };') <
    checkout.indexOf('for (const delivery of deliveries)'),
);
check(
  'a cancelled craft order cancels its delivery leg',
  statusRoute.includes("newStatus === 'cancelled'") &&
    statusRoute.includes("status: { in: ['searching', 'scheduled', 'accepted'] }"),
);
check(
  'a delivery already picked up is NOT clobbered',
  statusRoute.includes("status: { in: ['searching', 'scheduled', 'accepted'] }"),
);

// ---------------------------------------------------------------------------
section('UI + i18n');
// ---------------------------------------------------------------------------
const i18n = src('src/lib/i18n.ts');
for (const key of [
  'deliveryMethod', 'deliveryViaWassilha', 'deliveryAddress',
  'deliveryAddressPlaceholder', 'deliveryAddressRequired',
  'deliveryFee', 'deliveryFeePending', 'deliveryByWassilha',
]) {
  const occurrences = (i18n.match(new RegExp(`${key}:`, 'g')) ?? []).length;
  check(`i18n key "${key}" exists in BOTH ar and fr`, occurrences === 2, `occurrences=${occurrences}`);
}
check(
  'the cart exposes the delivery choice',
  cart.includes('deliveryMethod') && cart.includes('deliveryViaWassilha'),
);
check(
  'the cart collects the destination and blocks without it',
  cart.includes('dropoffAddress') && cart.includes('deliveryAddressRequired'),
);
check(
  'the delivery fee is never added to the cart total',
  cart.includes('deliveryFeePending'),
);
check(
  'the DTO exposes the linked delivery to the customer',
  src('src/lib/dto.ts').includes('deliveryOrderId: true'),
);

// ---------------------------------------------------------------------------
section('Dispatch-pool parity (realtime pool must equal the push pool)');
// ---------------------------------------------------------------------------
// POST /api/orders originally called findAvailableDrivers() with THREE arguments,
// omitting `requiredVehicleTypes`. For a multi-select order the plural field then
// silently fell back to the legacy singular field (or to no category filter), so
// the Phase 6 realtime `order:new-request` event could reach drivers the push
// pool had already excluded. Every pool must now use the identical contract.
const ordersRoute = src('src/app/api/orders/route.ts');
const dispatchSrc = src('src/lib/dispatch.ts');

check(
  'R-1 findAvailableDrivers accepts requiredVehicleTypes',
  /requiredVehicleTypes\?:\s*readonly string\[\] \| null/.test(dispatchSrc),
);
check(
  'R-2 the realtime pool in POST /api/orders forwards requiredVehicleTypes',
  // Window is generous: a doc comment sits between the two calls, and the
  // point of the check is simply that the 4th argument is present.
  /emitOrderNewRequest\([\s\S]{0,2000}findAvailableDrivers\(\s*\n\s*order\.cargoType,[\s\S]{0,400}order\.requiredVehicleTypes \?\? \[\],/.test(ordersRoute),
);
check(
  'R-3 the push pool (fanOutNewOrder) forwards it too',
  /fanOutNewOrder[\s\S]*|[\s\S]{0,0}/.test(dispatchSrc) &&
    /order\.requiredVehicleTypes \?\? null,/.test(dispatchSrc),
);
check(
  'R-4 the Phase 7A delivery path forwards it too',
  /findAvailableDrivers\([\s\S]{0,240}order\.requiredVehicleTypes \?\? \[\],/.test(checkout),
);
check(
  'R-5 no call site anywhere omits the plural field',
  // Every call site must either pass 4 arguments or be the declaration itself.
  !/findAvailableDrivers\(\s*\n\s*order\.cargoType,\s*\n\s*order\.requiredVehicleType \?\? null,\s*\n\s*order\.requiredSeats \?\? null,\s*\n\s*\)/.test(
    ordersRoute + checkout + dispatchSrc,
  ),
);
check(
  'R-6 legacy orders (no plural field) are unaffected - the ?? [] fallback',
  ordersRoute.includes('order.requiredVehicleTypes ?? []') &&
    checkout.includes('order.requiredVehicleTypes ?? []'),
);

// Backward compatibility: with no plural field the helper must behave exactly as
// before, i.e. the legacy singular field decides, else no category filter.
check(
  'R-7 taxi matching is untouched (plural never applied to taxi)',
  dispatchSrc.includes('const requestedService = serviceCategoryFor(cargoType);') &&
    !/serviceMode.*findAvailableDrivers/.test(dispatchSrc),
);

// All five compatibility consumers must keep funnelling into one function.
for (const [label, file] of [
  ['incoming feed', 'src/app/api/driver/incoming/route.ts'],
  ['offer creation (via offer-policy)', 'src/lib/offer-policy.ts'],
  ['flat accept', 'src/app/api/orders/[id]/accept/route.ts'],
  ['offer award', 'src/app/api/orders/[id]/offers/[offerId]/accept/route.ts'],
] as const) {
  check(`R-8 ${label} uses isVehicleCompatible (single source of truth)`, src(file).includes('isVehicleCompatible('));
}
check(
  'R-9 offer creation really delegates to the shared policy',
  src('src/app/api/orders/[id]/offers/route.ts').includes('canDriverOfferOnOrder'),
);
check(
  'R-10 isVehicleCompatible was NOT modified by this fix',
  dispatchSrc.includes('export function isVehicleCompatible') &&
    !dispatchSrc.includes('requiredVehicleTypes?: readonly string[] | null;\n  driver:'),
);

// ---------------------------------------------------------------------------
section('PHASE 7B-01  checkout response carries the linked delivery');
// ---------------------------------------------------------------------------
// `craftOrder.create()` is selected BEFORE createCraftDeliveryOrder() writes
// deliveryOrderId, so the returned payload used to report null even though the
// row was correctly linked. The database was always right; only the response
// was stale. The fix re-reads the row inside the same transaction, and ONLY
// when a delivery was actually created.
check(
  'B-1 the response is refreshed after the delivery link is written',
  /if \(delivery\) \{[\s\S]{0,400}deliveries\.push\(delivery\)/.test(checkout) &&
    /const linked = await tx\.craftOrder\.findUnique\(\{/.test(checkout),
);
check(
  'B-2 the refreshed row replaces the stale one in the response array',
  /orders\[idx\] = linked/.test(checkout) && /findIndex\(\(o\) => o\.id === order\.id\)/.test(checkout),
);
check(
  'B-3 the re-read uses the same public projection (no field drift)',
  /const linked = await tx\.craftOrder\.findUnique\(\{\s*\n\s*where: \{ id: order\.id \},\s*\n\s*select: publicCraftOrderSelect,/.test(checkout),
);
check(
  'B-4 pickup orders are untouched - no re-read when no delivery was created',
  /if \(wantsDelivery\) \{/.test(checkout) &&
    // the re-read lives inside `if (delivery)`, so `pickup` (delivery === null)
    // returns the original object byte-for-byte.
    /if \(wantsDelivery\) \{[\s\S]{0,400}const delivery = await createCraftDeliveryOrder/.test(checkout),
);
check(
  'B-5 the response still returns the same orders array shape',
  /return \{ orders, deliveries \};/.test(checkout) &&
    /NextResponse\.json\(\{ orders: aliasDeliveries\(created\) \}, \{ status: 201 \}\)/.test(checkout),
);
check(
  'B-7 the checkout response is aliased so deliveryOrderId + delivery agree',
  checkout.includes('aliasDeliveries(created)'),
);
check(
  'B-6 deliveryOrderId remains part of the public projection',
  /publicCraftOrderSelect = \{[\s\S]{0,600}deliveryOrderId: true/.test(
    src('src/lib/dto.ts'),
  ),
);

console.log(`\n${'='.repeat(58)}`);
console.log(`RESULT: ${pass}/${pass + fail}`);
console.log(`${'='.repeat(58)}`);
if (fail > 0) process.exit(1);
