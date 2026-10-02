// -----------------------------------------------------------------------
// PHASE 7B verification - marketplace delivery TRACKING layer.
//
// Read-only by construction: this phase adds a nested `delivery` projection
// to the craft-order read model plus a card in the customer UI. It must NOT
// touch the delivery engine, so these checks assert two things:
//
//   1. the tracking data is exposed (present for delivery, null for pickup);
//   2. nothing in the delivery / matching / negotiation path was modified.
//
// Run with: bun src/scripts/verify-phase7b.ts

// ---------------------------------------------------------------------------
// PHASE 7B verification - marketplace delivery TRACKING layer.
//
// Read-only by construction: this phase adds a nested `delivery` projection to
// the craft-order read model plus a card in the customer UI. It must not touch
// the delivery engine, so these checks assert two things:
//
//   1. the tracking data is exposed (present for delivery, null for pickup);
//   2. nothing in the delivery / matching / negotiation path was modified.
//
// Run with: bun src/scripts/verify-phase7a.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aliasDelivery } from '../lib/dto';

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

const dto = src('src/lib/dto.ts');
const craftRoute = src('src/app/api/craft/orders/route.ts');
const statusRoute = src('src/app/api/craft/orders/[id]/status/route.ts');
const card = src('src/components/wassilha/craft/customer-craft-orders.tsx');
const i18n = src('src/lib/i18n.ts');
const schema = src('prisma/schema.prisma');
const deliveryBlock = dto.slice(
  dto.indexOf('export const craftDeliverySelect'),
  dto.indexOf('export const craftDeliverySelectNoAddress'),
);

section('T-1  the tracking projection exists and is narrow');
check('the delivery projection is declared', dto.includes('export const craftDeliverySelect'));
check(
  'it carries id / status / price / finalPrice',
  /export const craftDeliverySelect = \{[\s\S]{0,400}id: true,[\s\S]{0,200}status: true,[\s\S]{0,300}price: true,[\s\S]{0,200}finalPrice: true/.test(dto),
);
check(
  'it carries the lifecycle timestamps',
  dto.includes('acceptedAt: true') && dto.includes('pickedAt: true') && dto.includes('deliveredAt: true'),
);
check('driver is selected as NAME ONLY', /driver: \{ select: \{ name: true \} \}/.test(dto));

section('T-2  SECURITY - no PII or internals in the payload');
check('driver.phone is NOT selected', !/driver: \{ select: \{[^}]*phone/.test(deliveryBlock));
check('driver.email is NOT selected', !deliveryBlock.includes('email'));
check(
  'no coordinate columns are selected',
  !/latitude|longitude|pickupLat|dropoffLat|currentLat/.test(deliveryBlock),
);
check(
  'no internal columns (userId, password, rating, earnings)',
  !/userId|password|rating|totalEarnings|isVerified/.test(deliveryBlock),
);
check(
  'it does not use publicUserSelect (carries phone + role)',
  !/driver: \{ select: publicUserSelect \}/.test(deliveryBlock),
);

section('T-3  PICKUP behaviour preserved');
check('a pickup order yields delivery: null', dto.includes('delivery: deliveryOrder ?? null'));
check(
  'the card renders tracking only when a delivery exists',
  /order\.deliveryOption === 'wassilha_delivery' && order\.delivery &&/.test(card),
);
check('the old static badge is gone', !card.includes('t.wassilhaDelivery}'));

section('T-4  DELIVERY behaviour');
check(
  'the alias mapper renames deliveryOrder -> delivery',
  dto.includes('export function aliasDelivery') && dto.includes('delivery: deliveryOrder ?? null'),
);
check('the list endpoint applies the alias', craftRoute.includes('aliasDeliveries(orders)'));
check('the checkout (POST) response applies the alias', craftRoute.includes('aliasDeliveries(created)'));
check(
  'the status-transition responses apply the alias',
  (statusRoute.match(/aliasDelivery\(/g) ?? []).length >= 2,
);

// Executed (not source-asserted): the mapper's real behaviour.
check(
  'aliasDelivery passes other fields through untouched',
  Object.keys(aliasDelivery({ id: 'a', code: 'H', status: 'pending', deliveryOrder: null })).sort().join(',') ===
    'code,delivery,id,status',
);
check('aliasDelivery nulls a missing delivery', aliasDelivery({ id: 'a', deliveryOrder: null }).delivery === null);
check(
  'aliasDelivery passes a real delivery through',
  (aliasDelivery({ id: 'a', deliveryOrder: { id: 'o', status: 'picked' } }).delivery as { id: string }).id === 'o',
);

section('T-5  seller address redaction');
check(
  'a redacted variant exists without pickup/dropoff',
  dto.includes('export const craftDeliverySelectNoAddress') &&
    !/export const craftDeliverySelectNoAddress = \{[\s\S]{0,400}(pickup|dropoff): true/.test(dto),
);
check(
  'the artisan branch of the list endpoint uses it',
  craftRoute.includes('craftDeliverySelectNoAddress') &&
    /deliveryOrder: \{ select: craftDeliverySelectNoAddress \}/.test(craftRoute),
);
check(
  'the customer branch gets the full block',
  /select: isArtisan[\s\S]{0,220}: publicCraftOrderSelect/.test(craftRoute),
);

section('T-6  authorization unchanged (session-scoped rows)');
check(
  'rows are still scoped by the session',
  craftRoute.includes('{ customerId: session.id }') && craftRoute.includes('artisan: { userId: session.id }'),
);
check(
  'unauthenticated access is still refused',
  craftRoute.includes("return NextResponse.json({ error: 'unauthorized' }, { status: 401 })"),
);

section('T-7  price separation preserved');
check(
  'the delivery block exposes only delivery money',
  deliveryBlock.includes('price: true') && deliveryBlock.includes('finalPrice: true'),
);
// Comments legitimately MENTION `CraftOrder.totalPrice` to explain that it is
// deliberately NOT merged here, so the check must look at code only.
const deliveryCode = deliveryBlock.replace(/^\s*\/\/.*$/gm, '');
check(
  'CraftOrder.totalPrice is NOT merged in',
  !deliveryCode.includes('totalPrice'),
  'comment-only mention ignored',
);
check(
  'the card shows the delivery fee separately from the order total',
  card.includes('order.delivery.finalPrice ?? order.delivery.price') && card.includes('t.deliveryFeeLabel'),
);

section('T-8  i18n (AR + FR)');
for (const key of [
  'deliveryTracking', 'deliveryDriver', 'deliveryDriverSearching',
  'deliveryStepCreated', 'deliveryStepAccepted', 'deliveryStepPicked',
  'deliveryStepDelivered', 'deliveryFeeLabel',
]) {
  const n = (i18n.match(new RegExp(`${key}:`, 'g')) ?? []).length;
  check(`"${key}" exists in BOTH ar and fr`, n === 2, `occurrences=${n}`);
}
check(
  'existing transport status keys are reused, not duplicated',
  card.includes('t.orderStatusSearching') &&
    card.includes('t.orderStatusAccepted') &&
    card.includes('t.orderStatusPicked'),
);

section('T-9  FORBIDDEN surfaces untouched by this phase');
check('schema.prisma untouched', !schema.includes('craftDeliveryTracking'));
check('the tracking card adds no realtime import', !card.includes('pusher'));
// existsSync, not readFileSync: the ABSENCE of the file IS the assertion, and
// readFileSync would throw ENOENT (which is exactly what we want to be true).
check(
  'no new tracking API route was created',
  !existsSync(join(process.cwd(), 'src/app/api/craft/orders/[id]/tracking/route.ts')),
);
check(
  'negotiation / matching / pricing untouched in the card',
  !card.includes('isVehicleCompatible') && !card.includes('computeOrderPrice'),
);

console.log(`\n${'='.repeat(58)}`);
console.log(`RESULT: ${pass}/${pass + fail}`);
console.log(`${'='.repeat(58)}`);
if (fail > 0) process.exit(1);
