// ---------------------------------------------------------------------------
// PHASE 9 verification — marketplace administration & moderation.
//
// The repo has no test framework, so — like the phase 1/2/5/6/7/8 verifiers —
// this file IS the gate. It is a SOURCE invariant suite: it asserts that the
// rules are actually present in the routes and the shared module, because the
// failure modes that matter here are all "someone edited a query and a
// moderation-gated listing leaked", which no unit test would catch.
//
// What it proves:
//   1. the additive schema is backward compatible (existing rows stay approved),
//   2. EVERY public product read carries the shared visibility gate,
//   3. a new product is never public before an admin decides,
//   4. moderation transitions are legal, atomic and explained,
//   5. a suspended seller keeps READ access but loses WRITE access,
//   6. reports never auto-punish, and closing one is terminal,
//   7. no new Phase 9 route leaks raw exception detail,
//   8. every new i18n key exists in BOTH Arabic and French.
//
// Run with: bun src/scripts/verify-phase9.ts
// ---------------------------------------------------------------------------

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

const schema = src('prisma/schema.prisma');
const mod = src('src/lib/marketplace-moderation.ts');
const auth = src('src/lib/auth.ts');
const dto = src('src/lib/dto.ts');
const i18n = src('src/lib/i18n.ts');

const productCreate = src('src/app/api/craft/products/route.ts');
const productPatch = src('src/app/api/craft/products/[id]/route.ts');
const productsMine = src('src/app/api/craft/products/mine/route.ts');
const artisanMe = src('src/app/api/craft/artisan/me/route.ts');
const artisanStats = src('src/app/api/craft/artisan/me/stats/route.ts');

const adminProducts = src('src/app/api/admin/craft/products/route.ts');
const adminModerate = src('src/app/api/admin/craft/products/[id]/moderate/route.ts');
const adminStores = src('src/app/api/admin/craft/stores/route.ts');
const adminOrders = src('src/app/api/admin/craft/orders/route.ts');
const adminReports = src('src/app/api/admin/craft/reports/route.ts');
const adminReportOne = src('src/app/api/admin/craft/reports/[id]/route.ts');
const suspendStore = src('src/app/api/admin/craft/artisans/[id]/suspend/route.ts');
const reinstateStore = src('src/app/api/admin/craft/artisans/[id]/reinstate/route.ts');
const createReport = src('src/app/api/craft/reports/route.ts');

// ---------------------------------------------------------------------------
section('P9-01  additive, backward-compatible schema');
// ---------------------------------------------------------------------------
check(
  'M9-01 existing products default to "approved" (no listing silently disappears)',
  /moderationStatus\s+String\s+@default\("approved"\)/.test(schema),
);
check(
  'M9-02 the moderation queue is indexed',
  /@@index\(\[moderationStatus, createdAt\]\)/.test(schema),
);
check(
  'M9-03 rejection/suspension reasons are stored as Text',
  /moderationReason\s+String\?\s+@db\.Text/.test(schema),
);
check(
  'M9-04 ArtisanProfile carries the suspension record',
  /suspendedAt\s+DateTime\?/.test(schema) && /suspensionReason\s+String\?\s+@db\.Text/.test(schema),
);
check(
  'M9-05 MarketplaceReport exists with a reporter + resolver',
  /model MarketplaceReport/.test(schema) &&
    /relation\("MarketplaceReportReporter"/.test(schema) &&
    /relation\("MarketplaceReportResolver"/.test(schema),
);
check(
  'M9-06 a report targets a product OR a store (nullable, never both required)',
  /^\s*productId\s+String\?/m.test(schema) && /^\s*artisanId\s+String\?/m.test(schema),
);
check(
  'M9-07 deleting a reported product/store keeps the report (SetNull, not cascade)',
  /onDelete: SetNull/.test(schema),
);

// ---------------------------------------------------------------------------
section('P9-02  public visibility is a WHITELIST on one shared gate');
// ---------------------------------------------------------------------------
check(
  'M9-08 the only publicly visible state is "approved"',
  /PUBLIC_PRODUCT_MODERATION_STATUS: ProductModerationStatus = 'approved'/.test(mod),
);
check(
  'M9-09 one exported gate object every public query spreads',
  /export const publicProductGate = \{[\s\S]*?moderationStatus: PUBLIC_PRODUCT_MODERATION_STATUS/.test(
    mod
  ),
);

// EVERY route/page that can render a product to a non-owner must carry the gate.
// A missing entry here is exactly the leak this suite exists to prevent.
const PUBLIC_READERS: [string, string][] = [
  ['products list API', 'src/app/api/craft/products/route.ts'],
  ['product detail API', 'src/app/api/craft/products/[id]/route.ts'],
  ['product Q&A API', 'src/app/api/craft/products/[id]/qa/route.ts'],
  ['public store API', 'src/app/api/craft/stores/[storeSlug]/route.ts'],
  ['public product-by-slug API', 'src/app/api/craft/stores/[storeSlug]/product/[productSlug]/route.ts'],
  ['checkout order creation', 'src/app/api/craft/orders/route.ts'],
  ['search query builder', 'src/lib/craft-search-query.ts'],
  ['AI agent', 'src/lib/ai-agent.ts'],
  ['sitemap', 'src/app/sitemap.ts'],
  ['marketplace page', 'src/app/craft/page.tsx'],
  ['search page', 'src/app/craft/search/page.tsx'],
  ['store page', 'src/app/craft/[storeSlug]/page.tsx'],
  ['product page', 'src/app/craft/[storeSlug]/product/[productSlug]/page.tsx'],
  ['product OG image', 'src/app/craft/[storeSlug]/product/[productSlug]/og/route.tsx'],
];

let ungated = 0;
for (const [label, path] of PUBLIC_READERS) {
  const has = src(path).includes('publicProductGate');
  if (!has) ungated++;
  check(`M9-10 public reader gated: ${label}`, has, path);
}
check(
  'M9-11 every public reader above carries the gate',
  ungated === 0,
  `${ungated} ungated`,
);

check(
  'M9-12 the seller-own list is NOT gated by public moderation (a seller must see their pending items)',
  productsMine.includes('sellerCraftProductSelect') && !productsMine.includes('publicProductGate'),
);
// Slice each PUBLIC product projection out of dto.ts on its own, otherwise a
// lazy regex would run past the closing brace and match a moderation field that
// belongs to the seller projection further down the file.
const publicProductProjection = dto.slice(
  dto.indexOf('export const publicCraftProductSelect'),
  dto.indexOf('export const publicArtisanStoreSelect')
);
const storefrontProjection = dto.slice(
  dto.indexOf('export const marketplaceProductSelect'),
  dto.indexOf('export const notificationSelect')
);
check(
  'M9-13 the public projections do NOT expose moderation internals',
  !publicProductProjection.includes('moderationStatus') &&
    !storefrontProjection.includes('moderationStatus'),
);
check(
  'M9-13b the seller projection DOES expose them (the seller must see the verdict)',
  dto.slice(
    dto.indexOf('export const sellerCraftProductSelect'),
    dto.indexOf('export const adminArtisanRowSelect')
  ).includes('moderationStatus'),
);

// ---------------------------------------------------------------------------
section('P9-03  a new product is NOT public before an admin decides');
// ---------------------------------------------------------------------------
check(
  'M9-14 creation sets moderationStatus: pending explicitly',
  /moderationStatus:\s*'pending'/.test(productCreate),
);
check(
  'M9-16 editing a REJECTED product resubmits it as pending and clears the reason',
  /existing\.moderationStatus === 'rejected'/.test(productPatch) &&
    /moderationStatus: 'pending', moderationReason: null/.test(productPatch),
);
check(
  'M9-17 editing an APPROVED product does not silently unpublish it',
  !/existing\.moderationStatus === 'approved'/.test(productPatch),
);

// ---------------------------------------------------------------------------
section('P9-04  moderation transitions are legal, atomic and explained');
// ---------------------------------------------------------------------------
check('M9-18 approve may not be applied to an already-approved product', /approve: \['pending', 'rejected', 'suspended'\]/.test(mod));
check(
  'M9-19 suspend applies only to a live product — no pending -> suspended -> approved review bypass',
  /suspend: \['approved'\]/.test(mod),
);
check('M9-20 restore applies only to a suspended product', /restore: \['suspended'\]/.test(mod));
check(
  'M9-21 canModerate fails CLOSED on an unknown stored status',
  /export function canModerate\(from: unknown, action[\s\S]*?isProductModerationStatus\(from\)\) return false;[\s\S]*?return ACTION_FROM\[action\]\.includes\(from\);/.test(
    mod
  ),
);
check(
  'M9-22 the transition is a compare-and-set (updateMany on the from-state)',
  /updateMany\(\{\s*where: \{ id, moderationStatus: from \}/.test(adminModerate),
);
check(
  'M9-23 a reject/suspend without a reason is refused (400)',
  /action === 'reject' \|\| action === 'suspend'\) && reason\.length < 2/.test(adminModerate),
);
check(
  'M9-24 the moderator identity comes from the session, not the body',
  adminModerate.includes('moderatedById: gate.session.id'),
);
check(
  'M9-25 an illegal transition is a 409, never a silent rewrite',
  adminModerate.includes("error: 'invalidTransition'") && adminModerate.includes('status: 409'),
);
check('M9-26 the seller is notified of the outcome', adminModerate.includes('createNotification'));
check(
  'M9-27 the admin queue is admin-gated and returns the seller projection',
  adminProducts.includes('requirePrivilegedAdmin') && adminProducts.includes('sellerCraftProductSelect'),
);

// ---------------------------------------------------------------------------
section('P9-05  store suspension reuses one status (no second flag to forget)');
// ---------------------------------------------------------------------------
check(
  'M9-28 suspend only from active, reinstate only from suspended',
  /canModerateStore[\s\S]*?action === 'suspend'\) return from === 'active'/.test(mod) &&
    /action === 'reinstate'\) return from === 'suspended'/.test(mod),
);
check(
  'M9-29 suspension stamps the reason + timestamp and is a compare-and-set',
  suspendStore.includes('suspensionReason: reason') &&
    suspendStore.includes("where: { id, status: 'active' }"),
);
check(
  'M9-30 reinstatement CLEARS the suspension record',
  reinstateStore.includes('suspensionReason: null') && reinstateStore.includes('suspendedAt: null'),
);
check(
  'M9-31 a suspended seller keeps READ access (requireArtisan)',
  /export async function requireArtisan/.test(auth) &&
    productsMine.includes('requireArtisan') &&
    artisanMe.includes('requireArtisan') &&
    artisanStats.includes('requireArtisan'),
);
check(
  'M9-32 ... but WRITES still require an active store (requireActiveArtisan)',
  productCreate.includes('requireActiveArtisan') && productPatch.includes('requireActiveArtisan'),
);

// ---------------------------------------------------------------------------
section('P9-06  reports record a complaint and NEVER auto-punish');
// ---------------------------------------------------------------------------
check(
  'M9-33 creating a report writes NO product/store moderation field',
  !/moderationStatus:\s*'(rejected|suspended)'/.test(createReport) &&
    !/status:\s*'suspended'/.test(createReport),
);
check(
  'M9-34 closing a report writes NO product/store moderation field',
  !/moderationStatus/.test(adminReportOne) && !/suspensionReason/.test(adminReportOne),
);
check(
  'M9-35 resolved/dismissed are TERMINAL (a closed report cannot be re-opened)',
  /resolved: \['open', 'reviewed'\]/.test(mod) && /dismissed: \['open', 'reviewed'\]/.test(mod),
);
check(
  'M9-36 only an admin can resolve, and it stamps the resolver identity',
  adminReportOne.includes('requirePrivilegedAdmin') &&
    adminReportOne.includes('resolvedById: gate.session.id'),
);
check(
  'M9-37 the reporter is the SESSION user, never a body field',
  createReport.includes('reporterId: session.id'),
);
check(
  'M9-38 a report against a non-public target 404s (no existence oracle)',
  createReport.includes('reportTargetIsPublic') && createReport.includes("error: 'notFound'"),
);
check(
  'M9-39 report creation is rate limited on the session id',
  createReport.includes('rateLimit(`marketplace-report:${session.id}`'),
);
check(
  'M9-40 one open report per reporter per target (queue cannot be flooded)',
  createReport.includes("status: { in: ['open', 'reviewed'] }") &&
    createReport.includes("error: 'alreadyReported'"),
);

// ---------------------------------------------------------------------------
section('P9-07  orders: two monies, never summed');
// ---------------------------------------------------------------------------
check(
  'M9-41 admin order oversight exists and is admin-gated',
  adminOrders.includes('requirePrivilegedAdmin') && adminOrders.includes('adminCraftOrderSelect'),
);

// ---------------------------------------------------------------------------
section('P9-08  no new route leaks raw exception detail');
// ---------------------------------------------------------------------------
const NEW_ROUTES: [string, string][] = [
  ['admin products', adminProducts],
  ['admin moderate', adminModerate],
  ['admin stores', adminStores],
  ['admin orders', adminOrders],
  ['admin reports', adminReports],
  ['admin report resolve', adminReportOne],
  ['store suspend', suspendStore],
  ['store reinstate', reinstateStore],
  ['create report', createReport],
];
for (const [label, body] of NEW_ROUTES) {
  check(`M9-42 no raw error detail: ${label}`, !/detail:\s*String\(e\)/.test(body));
}

// ---------------------------------------------------------------------------
section('P9-09  every new key exists in BOTH Arabic and French');
// ---------------------------------------------------------------------------
// Translation is a UNION of the ar and fr objects, so a key missing from either
// locale is a compile error in every component that reads it. Splitting the two
// blocks and checking them separately is what catches a half-finished locale.
const ar = i18n.slice(i18n.indexOf('  ar: {'), i18n.indexOf('  fr: {'));
const fr = i18n.slice(i18n.indexOf('  fr: {'));
const KEYS = [
  'marketplaceAdmin',
  'mpProductsTab',
  'mpOrdersTab',
  'mpReportsTab',
  'mpStoresTab',
  'mpStatusPending',
  'mpStatusApproved',
  'mpStatusRejected',
  'mpStatusSuspended',
  'mpActionApprove',
  'mpActionReject',
  'mpActionSuspend',
  'mpActionRestore',
  'mpReasonLabel',
  'mpReasonPlaceholder',
  'mpModerationReason',
  'mpStoreColumn',
  'mpProductColumn',
  'mpOwnerColumn',
  'mpNoProducts',
  'mpNoOrders',
  'mpNoReports',
  'mpNoStores',
  'mpProductSubtotal',
  'mpDeliveryFee',
  'mpSuspendStore',
  'mpReinstateStore',
  'mpSuspendedAt',
  'mpReportOpen',
  'mpReportReviewed',
  'mpReportResolved',
  'mpReportDismissed',
  'mpMarkReviewed',
  'mpMarkResolved',
  'mpMarkDismissed',
  'mpReportsNeverAutoPunish',
  'reportReasonInappropriate',
  'reportReasonCounterfeit',
  'moderationNoticePending',
  'moderationNoticeRejected',
  'productApproved',
  'productApprovedBody',
  'productRejected',
  'productRejectedBody',
  'productSuspended',
  'productSuspendedBody',
  'productRestored',
  'productRestoredBody',
  'storeSuspended',
  'storeSuspendedBody',
  'storeReinstated',
  'storeReinstatedBody',
];
const missingAr = KEYS.filter((k) => !ar.includes(`${k}:`));
const missingFr = KEYS.filter((k) => !fr.includes(`${k}:`));
check('M9-43 all Phase 9 keys present in Arabic', missingAr.length === 0, missingAr.join(','));
check('M9-44 all Phase 9 keys present in French', missingFr.length === 0, missingFr.join(','));
check(
  'M9-45 the admin UI renders both monies as separate labelled figures',
  src('src/components/wassilha/admin/admin-marketplace.tsx').includes('mpProductSubtotal') &&
    src('src/components/wassilha/admin/admin-marketplace.tsx').includes('mpDeliveryFee'),
);

// ---------------------------------------------------------------------------
console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);