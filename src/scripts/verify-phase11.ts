// Phase 11 — notifications: five new NotificationType members wired end to
// end (create path -> i18n AR+FR -> UI type meta), plus the service-reminder
// cron. Source-invariant checks only: no DB, no network, no mocks — the same
// contract every verify-phase*.ts in this directory upholds.
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

const types = src('src/lib/types.ts');
const i18n = src('src/lib/i18n.ts');
const notifications = src('src/lib/notifications.ts');
const productsRoute = src('src/app/api/craft/products/route.ts');
const moderateRoute = src('src/app/api/admin/craft/products/[id]/moderate/route.ts');
const cronRoute = src('src/app/api/cron/send-reminders/route.ts');
const vercelJson = src('vercel.json');
const acceptRoute = src('src/app/api/orders/[id]/accept/route.ts');
const craftStatusRoute = src('src/app/api/craft/orders/[id]/status/route.ts');
const dispatch = src('src/lib/dispatch.ts');
const craftOrdersRoute = src('src/app/api/craft/orders/route.ts');
const center = src('src/components/wassilha/notifications/notification-center.tsx');

const NEW_TYPES = [
  'new_product',
  'service_reminder',
  'order_accepted',
  'new_delivery_request',
  'new_craft_order',
] as const;

// ---------------------------------------------------------------------------
section('P11-01  type system: five new NotificationType members');
// ---------------------------------------------------------------------------
for (const t of NEW_TYPES) {
  check(`M11-01 union includes '${t}'`, types.includes(`| '${t}'`));
}
check(
  'M11-02 NotificationData still carries the i18n ref (no schema change needed)',
  types.includes('i18n?: NotificationI18nRef'),
);

// ---------------------------------------------------------------------------
section('P11-02  i18n: every Phase 11 key exists in BOTH locale blocks');
// ---------------------------------------------------------------------------
const ar = i18n.slice(i18n.indexOf('  ar: {'), i18n.indexOf('  fr: {'));
const fr = i18n.slice(i18n.indexOf('  fr: {'));
const KEYS = [
  'newProductTitle',
  'newProductBody',
  'serviceReminderTitle',
  'serviceReminderBody',
  'orderAcceptedTitle',
  'orderAcceptedBody',
  'newDeliveryRequestTitle',
  'newDeliveryRequestBody',
  'newCraftOrderTitle',
  'newCraftOrderBody2',
];
const missingAr = KEYS.filter((k) => !ar.includes(`${k}:`));
const missingFr = KEYS.filter((k) => !fr.includes(`${k}:`));
check('M11-03 all Phase 11 keys present in Arabic', missingAr.length === 0, missingAr.join(','));
check('M11-04 all Phase 11 keys present in French', missingFr.length === 0, missingFr.join(','));

// The order_accepted flow in /api/orders/:id/accept reuses the Phase 6 keys;
// both locales must resolve them too or a French user reads stored Arabic.
const ACCEPT_KEYS = ['orderAccepted:', 'driverOnTheWay:', 'driverOnTheWayNamed:'];
const missingAcceptAr = ACCEPT_KEYS.filter((k) => !ar.includes(k));
const missingAcceptFr = ACCEPT_KEYS.filter((k) => !fr.includes(k));
check('M11-05 accept-flow keys present in Arabic', missingAcceptAr.length === 0, missingAcceptAr.join(','));
check('M11-06 accept-flow keys present in French', missingAcceptFr.length === 0, missingAcceptFr.join(','));

// ---------------------------------------------------------------------------
section('P11-03  NEW_PRODUCT: follower fan-out on approval');
// ---------------------------------------------------------------------------
check(
  'M11-07 the shared helper lives in the single write path (notifications.ts)',
  notifications.includes('export async function notifyFollowersNewProduct('),
);
check(
  'M11-08 helper derives followers with one distinct query',
  notifications.includes('where: { product: { artisanId } }') &&
    notifications.includes("distinct: ['userId']"),
);
check(
  'M11-09 helper excludes the shop owner (no self-notification)',
  notifications.includes('id !== artisan.userId'),
);
check(
  'M11-10 helper writes typed rows with realtime off (no Pusher storm)',
  notifications.includes("type: 'new_product'") && notifications.includes('realtime: false'),
);
check(
  'M11-11 helper carries newProductTitle/newProductBody i18n keys',
  notifications.includes("titleKey: 'newProductTitle'") &&
    notifications.includes("bodyKey: 'newProductBody'"),
);
check(
  'M11-12 create route calls the helper on the pre-approved path',
  productsRoute.includes('void notifyFollowersNewProduct(') &&
    productsRoute.includes("product.moderationStatus === 'approved'"),
);
check(
  'M11-13 admin approval fires the fan-out (the real trigger today)',
  moderateRoute.includes('void notifyFollowersNewProduct(') &&
    moderateRoute.includes("action === 'approve'"),
);
check(
  'M11-14 moderate route selects the artisan PROFILE id the helper needs',
  moderateRoute.includes('artisanId: true'),
);
check(
  'M11-15 moderation approval stays fire-and-forget (outage never undoes it)',
  moderateRoute.includes('follower fan-out failed'),
);

// ---------------------------------------------------------------------------
section('P11-04  SERVICE_REMINDER: daily cron, gated, customer-scoped');
// ---------------------------------------------------------------------------
check('M11-16 cron route exists', cronRoute.includes('handleReminderCron'));
check(
  'M11-17 cron gate mirrors dispatch-scheduled (CRON_SECRET + timing-safe)',
  cronRoute.includes('process.env.CRON_SECRET') &&
    cronRoute.includes('timingSafeEqual') &&
    cronRoute.includes('isCronAuthorized'),
);
check(
  'M11-18 no secret configured refuses to run (never an open endpoint)',
  /if \(!secret\) return false;/.test(cronRoute),
);
check(
  'M11-19 Vercel Cron-compatible GET export (+ POST alias)',
  cronRoute.includes('export async function GET(') &&
    cronRoute.includes('export async function POST('),
);
check(
  'M11-20 reminder rows are typed and realtime-off',
  cronRoute.includes("type: 'service_reminder'") && cronRoute.includes('realtime: false'),
);
check(
  'M11-21 reminder carries serviceReminderTitle/serviceReminderBody keys',
  cronRoute.includes("titleKey: 'serviceReminderTitle'") &&
    cronRoute.includes("bodyKey: 'serviceReminderBody'"),
);
check(
  'M11-22 only inactive CUSTOMERS are targeted (orders none since window)',
  cronRoute.includes("role: 'customer'") &&
    cronRoute.includes('orders: { none: { createdAt: { gte: since } } }'),
);
check(
  'M11-23 7-day inactivity window and a bounded batch',
  cronRoute.includes('REMINDER_WINDOW_DAYS = 7') && cronRoute.includes('REMINDER_BATCH'),
);
check(
  'M11-23b reminded users leave the candidate set (batch rotates, no repeat spam)',
  cronRoute.includes("none: { type: 'service_reminder', createdAt: { gte: since } }") &&
    cronRoute.includes("orderBy: { createdAt: 'asc' }"),
);
check(
  'M11-24 vercel.json schedules the route daily',
  vercelJson.includes('/api/cron/send-reminders') &&
    /"schedule": "\d+ \d+ \* \* \*"/.test(vercelJson),
);

// ---------------------------------------------------------------------------
section('P11-05  ORDER_ACCEPTED: taxi/cargo accept + artisan confirmation');
// ---------------------------------------------------------------------------
check(
  'M11-25 /api/orders/:id/accept rows are typed order_accepted',
  acceptRoute.includes("type: 'order_accepted'"),
);
check('M11-26 accept row names the driver who accepted', acceptRoute.includes('driverName'));
check(
  'M11-27 craft status route defines the order-accepted helper',
  craftStatusRoute.includes('async function notifyCustomerOrderAccepted('),
);
check(
  'M11-28 helper writes typed order_accepted rows with i18n keys',
  craftStatusRoute.includes("type: 'order_accepted'") &&
    craftStatusRoute.includes("titleKey: 'orderAcceptedTitle'") &&
    craftStatusRoute.includes("bodyKey: 'orderAcceptedBody'"),
);
check(
  'M11-29 fires only on artisan-driven pending -> confirmed',
  craftStatusRoute.includes("newStatus === 'confirmed'") &&
    craftStatusRoute.includes("roleForCheck === 'artisan'"),
);

// ---------------------------------------------------------------------------
section('P11-06  DRIVER_NOTIFICATION: new_delivery_request fan-out');
// ---------------------------------------------------------------------------
check(
  'M11-30 fanOutNewOrder rows are typed new_delivery_request',
  dispatch.includes("type: 'new_delivery_request'"),
);
check(
  'M11-31 driver rows carry the newDeliveryRequest i18n keys',
  dispatch.includes("titleKey: 'newDeliveryRequestTitle'") &&
    dispatch.includes("bodyKey: 'newDeliveryRequestBody'"),
);
check(
  'M11-32 driver fan-out stays realtime-off (Pusher fan-out covers urgency)',
  dispatch.includes('realtime: false'),
);
check('M11-33 the request payload still names its service type', dispatch.includes('serviceType:'));

// ---------------------------------------------------------------------------
section('P11-07  ARTISAN_NOTIFICATION: new_craft_order on checkout');
// ---------------------------------------------------------------------------
check(
  'M11-34 artisan rows are typed new_craft_order',
  craftOrdersRoute.includes("type: 'new_craft_order'"),
);
check(
  'M11-35 artisan rows carry newCraftOrderTitle + body2 (named) i18n keys',
  craftOrdersRoute.includes("titleKey: 'newCraftOrderTitle'") &&
    craftOrdersRoute.includes("bodyKey: named ? 'newCraftOrderBody2' : 'newCraftOrderBody'"),
);
check(
  'M11-36 checkout notification stays fire-and-forget',
  craftOrdersRoute.includes('void notifyArtisanNewOrder('),
);

// ---------------------------------------------------------------------------
section('P11-08  UI: the bell renders all five new types');
// ---------------------------------------------------------------------------
for (const t of NEW_TYPES) {
  check(`M11-37 TYPE_META entry for '${t}'`, center.includes(`  ${t}: {`));
}
check(
  'M11-38 DEFAULT_TYPE_META fallback preserved for unknown types',
  center.includes('DEFAULT_TYPE_META'),
);

// ---------------------------------------------------------------------------
console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
