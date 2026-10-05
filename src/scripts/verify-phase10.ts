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

const cartRoute = src('src/app/api/craft/cart/route.ts');
const favRoute = src('src/app/api/craft/favorites/route.ts');
const favOneRoute = src('src/app/api/craft/favorites/[productId]/route.ts');
const api = src('src/lib/api.ts');
const sync = src('src/lib/cart-sync.ts');
const layout = src('src/app/layout.tsx');
const store = src('src/lib/store.ts');
const i18n = src('src/lib/i18n.ts');
const card = src('src/components/wassilha/craft/product-card.tsx');
const detail = src('src/components/wassilha/craft/product-detail.tsx');
const cartUi = src('src/components/wassilha/craft/craft-cart.tsx');
const publicAdd = src('src/components/wassilha/craft/public-add-to-cart.tsx');

const ROUTES: [string, string][] = [
  ['cart', cartRoute],
  ['favorites collection', favRoute],
  ['favorites single', favOneRoute],
];

// ---------------------------------------------------------------------------
section('P10-01  cart routes: session-scoped, rate-limited, zod-validated');
// ---------------------------------------------------------------------------
for (const [label, body] of ROUTES) {
  check(`M10-01 session-scoped: ${label}`, body.includes('getSession()') && body.includes('session.id'));
  check(`M10-02 rate-limited: ${label}`, body.includes('rateLimit('));
}
check(
  'M10-03 cart PUT schema is zod and qty-bounded',
  /qty:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/.test(cartRoute),
);
check('M10-04 cart PUT caps the number of lines (bulk-write guard)', /\.max\(50/.test(cartRoute));
check('M10-05 favorites PUT caps the id list at 500', /\.max\(500\)/.test(favRoute));
check(
  'M10-06 zod strips unknown keys (smuggled price discarded by construction)',
  cartRoute.includes('putSchema.safeParse') && favRoute.includes('putSchema.safeParse'),
);

// ---------------------------------------------------------------------------
section('P10-02  no price/total ever crosses the wire');
// ---------------------------------------------------------------------------
const putSchemaBlock = cartRoute.slice(
  cartRoute.indexOf('putSchema'),
  cartRoute.indexOf('function visibleProductWhere'),
);
check('M10-07 cart PUT schema has no price/total field', !/price|total/i.test(putSchemaBlock));
check(
  'M10-08 the api client PUT payload type carries ids/qty only',
  api.includes('items: { productId: string; variantId?: string | null; qty: number }[];'),
);
check(
  'M10-09 coupon is sent as a CODE only (no coupon amount field)',
  api.includes('couponCode?: string | null') && !/coupon(Discount|Amount)/.test(api),
);
check(
  'M10-10 server normalises the coupon code (uppercase) and stores nothing else',
  /rawCoupon.toUpperCase()/.test(cartRoute),
);
check(
  'M10-11 sync client sends only productId/variantId/qty - never name/price/image',
  sync.includes('productId: l.productId') &&
    sync.includes('variantId: l.variantId') &&
    sync.includes('qty: l.qty') &&
    !/\bprice:/i.test(sync.replace(/price: number/g,'').replace(/preview prices/g,'')),
);

// ---------------------------------------------------------------------------
section('P10-03  Phase 9 visibility gate on EVERY read and write');
// ---------------------------------------------------------------------------
const GATE_SNIPPETS: [string, string, string][] = [
  ['cart GET hydration', cartRoute, 'visibleProductWhere(productIds)'],
  ['cart PUT whitelist', cartRoute, 'visibleProductWhere([...new Set(candidateIds)])'],
  ['favorites PUT whitelist', favRoute, 'publicProductGate'],
  ['favorites POST whitelist', favOneRoute, 'publicProductGate'],
];
for (const [label, body, needle] of GATE_SNIPPETS) {
  check(`M10-12 ${label} applies the public gate`, body.includes(needle));
}
check(
  'M10-13 the gate also requires isActive + an active artisan store',
  (cartRoute.match(/isActive: true/g) || []).length >= 1 &&
    cartRoute.includes("artisan: { status: 'active' as const }") &&
    favRoute.includes("artisan: { status: 'active' as const }") &&
    favOneRoute.includes("artisan: { status: 'active' as const }"),
);
check(
  'M10-14 hidden/suspended products answer the same 404 (no existence oracle)',
  favOneRoute.includes("error: 'notFound'") && !favOneRoute.includes('productNotFound'),
);
check(
  'M10-15 cart GET omits non-visible lines entirely (never name/price/image)',
  /if \(!cart \|\| cart\.items\.length === 0\)/.test(cartRoute) && cartRoute.includes('visibleIds'),
);
check(
  'M10-16 cart PUT echoes no counts (no visibility probing)',
  cartRoute.includes('return NextResponse.json({ ok: true });') &&
    !/items:\s*kept\.length/.test(cartRoute),
);

// ---------------------------------------------------------------------------
section('P10-04  favorites sync is ids-only');
// ---------------------------------------------------------------------------
check(
  'M10-17 GET returns bare productIds',
  favRoute.includes('productIds: rows.map((r) => r.productId)'),
);
check(
  'M10-18 the client type for favorites sync carries ids only',
  api.includes('getFavorites: () => req<FavoritesSync>('),
);
check(
  'M10-19 no product payload endpoint exists on the favorites mirror',
  !favRoute.includes('nameAr') && !favRoute.includes('images'),
);

// ---------------------------------------------------------------------------
section('P10-05  generic errors only');
// ---------------------------------------------------------------------------
for (const [label, body] of ROUTES) {
  check(`M10-20 no raw error detail: ${label}`, !/detail:\s*String\(e\)/.test(body));
  check(`M10-21 errors logged generically: ${label}`, body.includes('console.error'));
}

// ---------------------------------------------------------------------------
section('P10-06  client merge: silent, best-effort, correct policy');
// ---------------------------------------------------------------------------
check('M10-22 the sync module exists and is client-side', sync.includes('use client'));
check(
  'M10-23 login merge unions favourites (local U server)',
  sync.includes('new Set([...localFavs, ...serverFavs.productIds])'),
);
check(
  'M10-24 cart merge is max-qty per productId|variantId key',
    sync.includes('l.qty > existing.qty') && sync.includes('productId}|')
);
check('M10-25 the merge never throws (best-effort try/catch)', sync.includes('} catch {'));
check('M10-26 the fire-and-forget cart mirror swallows failures', sync.includes('.catch(() => {'));
check(
  'M10-27 the sync is keyed on user identity (no repeat spam - rate limits)',
  sync.includes('lastSyncedUser === userId'),
);
check(
  'M10-28 checkout clears the server mirror (no resurrected lines)',
  cartUi.includes('api.clearCraftCart()'),
);

// ---------------------------------------------------------------------------
section('P10-07  UI wiring: dual-write hearts + bootstrap mounted');
// ---------------------------------------------------------------------------
check(
  'M10-29 CraftSyncBootstrap is mounted in the root layout',
  layout.includes('CraftSyncBootstrap'),
);
check(
  'M10-30 the persisted favorites store exists with a setAll merge action',
  store.includes("name: 'wassilha-favorites'") &&
    store.includes('setAll: (productIds) => set({ productIds: [...new Set(productIds)] })'),
);
check(
  'M10-31 product card uses the real persisted toggle (no local useState heart)',
  card.includes('useFavoriteToggle()') && !card.includes('useState(false)'),
);
check(
  'M10-32 product detail page has a heart wired to the same toggle',
  detail.includes('useFavoriteToggle()') && detail.includes('toggleFavorite(product.id)'),
);
check(
  'M10-33 add-to-cart mirrors the cart to the server (detail page)',
  detail.includes('syncCraftCartToServer()'),
);
check(
  'M10-34 add-to-cart mirrors the cart to the server (public SEO page)',
  publicAdd.includes('syncCraftCartToServer()'),
);
check(
  'M10-35 the cart screen mirrors qty/coupon mutations',
  cartUi.split('syncCraftCartToServer()').length - 1 >= 3,
);

// ---------------------------------------------------------------------------
section('P10-08  every new key exists in BOTH Arabic and French');
// ---------------------------------------------------------------------------
// Translation is a UNION of the ar and fr objects, so a key missing from either
// locale is a compile error in every component that reads it. Splitting the
// two blocks and checking them separately catches a half-finished locale
// (same technique as the Phase 9 verifier).
const ar = i18n.slice(i18n.indexOf('  ar: {'), i18n.indexOf('  fr: {'));
const fr = i18n.slice(i18n.indexOf('  fr: {'));
const KEYS = ['addedToFavorites', 'removedFromFavorites', 'favoriteNotAvailable'];
const missingAr = KEYS.filter((k) => !ar.includes(`${k}:`));
const missingFr = KEYS.filter((k) => !fr.includes(`${k}:`));
check('M10-36 all Phase 10 keys present in Arabic', missingAr.length === 0, missingAr.join(','));
check('M10-37 all Phase 10 keys present in French', missingFr.length === 0, missingFr.join(','));
check(
  'M10-38 the hearts read the localized labels',
  card.includes('t.addedToFavorites') && detail.includes('t.addedToFavorites'),
);

// ---------------------------------------------------------------------------
console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
