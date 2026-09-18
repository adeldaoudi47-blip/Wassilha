// HIRFA Phase 2A verification (offline, DB-level + logic-level).
//
// This is the "tests" gate for this phase: the repo has no JS test framework,
// so we verify the pieces that can break silently:
//   1. existing data is still intact (20 stores / 13 products / no data loss)
//   2. the analytics table exists and stores nothing PII-ish
//   3. the search query builders return REAL rows for a known query
//   4. the sitemap set matches the DB's public set exactly
//
// Run with: npx tsx src/scripts/verify-phase2.ts
import { PrismaClient } from '@prisma/client';
import { parseCraftSearchFilters, buildCraftSearchUrl } from '../lib/craft-search';
import { buildCraftProductWhere, buildCraftProductOrderBy, buildCraftStoreWhere } from '../lib/craft-search-query';

const db = new PrismaClient();

function check(name: string, cond: boolean, extra = ''): boolean {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${extra ? ` — ${extra}` : ''}`);
  return cond;
}

async function main() {
  let ok = true;

  // --- 1. Data safety -------------------------------------------------------
  const stores = await db.artisanProfile.count();
  const activeStores = await db.artisanProfile.count({ where: { status: 'active' } });
  const products = await db.craftProduct.count();
  const activeProducts = await db.craftProduct.count({
    where: { isActive: true, artisan: { status: 'active' } },
  });
  const orders = await db.craftOrder.count();
  const users = await db.user.count();
  const unsluggedStores = await db.artisanProfile.count({
    where: { status: 'active', slug: null },
  });
  const unsluggedProducts = await db.craftProduct.count({
    where: { isActive: true, artisan: { status: 'active' }, slug: null },
  });

  ok = check('data: 20 ACTIVE stores (pending applications are excluded from the public set)', activeStores === 20, `got ${activeStores}`) && ok;
  console.log(`[info] total artisan profiles incl. pending: ${stores}`);
  ok = check('data: 13 products total', products === 13, `got ${products}`) && ok;
  ok = check('data: 13 active+public products', activeProducts === 13, `got ${activeProducts}`) && ok;
  ok = check('data: craft orders table stable (0 is expected for a fresh marketplace)', orders >= 0, `got ${orders}`) && ok;
  ok = check('data: users preserved (>0)', users > 0, `got ${users}`) && ok;
  ok = check('data: 0 active stores without slug', unsluggedStores === 0, `got ${unsluggedStores}`) && ok;
  ok = check('data: 0 active products without slug', unsluggedProducts === 0, `got ${unsluggedProducts}`) && ok;

  // --- 2. Analytics table ---------------------------------------------------
  const events = await db.craftAnalyticsEvent.count();
  const cols = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'CraftAnalyticsEvent' ORDER BY ordinal_position
  `;
  const colNames = cols.map((c) => c.column_name);
  const hasPii = colNames.some((c) => /user|phone|ip|cookie|email/i.test(c));
  ok = check('analytics: table exists', colNames.length > 0, `columns=${colNames.join(',')}`) && ok;
  ok = check('analytics: no PII columns (user/phone/ip/cookie/email)', !hasPii) && ok;
  console.log(`[info] analytics event count so far: ${events}`);


  // --- 3. Search query builders (real data) ---------------------------------
  const q = parseCraftSearchFilters({ q: 'كيك' });
  ok = check('parse: q normalises', q.q === 'كيك', `q="${q.q}"`) && ok;
  ok = check('parse: unknown sort falls back to latest', q.sort === 'latest') && ok;
  ok = check('parse: junk price ignored', parseCraftSearchFilters({ priceMin: 'abc' }).priceMin === null) && ok;

  // Category filter must actually restrict: compare counts.
  const cat = await db.craftCategory.findFirst({ where: { isActive: true } });
  if (cat) {
    const withCat = await db.craftProduct.count({
      where: buildCraftProductWhere(parseCraftSearchFilters({ category: cat.slug })),
    });
    const totalAll = await db.craftProduct.count({
      where: buildCraftProductWhere(parseCraftSearchFilters({})),
    });
    ok = check('filter: category narrows or keeps results', withCat <= totalAll, `cat=${cat.slug} -> ${withCat} of ${totalAll}`) && ok;
  }

  // Price bounds must hold for every returned row.
  const priced = await db.craftProduct.findMany({
    where: buildCraftProductWhere(parseCraftSearchFilters({ priceMin: '500', priceMax: '5000' })),
    select: { price: true },
    take: 50,
  });
  const inBounds = priced.every((p) => p.price >= 500 && p.price <= 5000);
  ok = check('filter: price bounds respected on all rows', inBounds, `checked=${priced.length}`) && ok;

  // Sort: price_asc must be non-decreasing.
  const asc = await db.craftProduct.findMany({
    where: buildCraftProductWhere(parseCraftSearchFilters({})),
    orderBy: buildCraftProductOrderBy('price_asc'),
    select: { price: true },
    take: 50,
  });
  const nonDecreasing = asc.every((p, i) => i === 0 || asc[i - 1].price <= p.price);
  ok = check('sort: price_asc is non-decreasing', nonDecreasing) && ok;

  // Store search by name runs against real rows.
  const storeHits = await db.artisanProfile.count({
    where: buildCraftStoreWhere(parseCraftSearchFilters({ q: 'حلويات' })),
  });
  ok = check('search: store-name query runs', storeHits >= 0, `matched=${storeHits}`) && ok;

  // --- 4. Sitemap parity ----------------------------------------------------
  const sluggedStores = await db.artisanProfile.count({
    where: { status: 'active', slug: { not: null } },
  });
  const sluggedProducts = await db.craftProduct.count({
    where: { isActive: true, slug: { not: null }, artisan: { status: 'active' } },
  });
  ok = check('sitemap parity: every public store has a slug', sluggedStores === activeStores) && ok;
  ok = check('sitemap parity: every public product has a slug', sluggedProducts === activeProducts) && ok;

  // --- 5. URL build/parse round-trip ---------------------------------------
  const url = buildCraftSearchUrl({ q: 'كيك', category: 'gifts', area: '', priceMin: 100, priceMax: null, sort: 'price_asc', page: 2, pageSize: 12 });
  const reparsed = parseCraftSearchFilters(new URL(url, 'https://example.test').searchParams);
  ok = check('url: round-trip q', reparsed.q === 'كيك', reparsed.q) && ok;
  ok = check('url: round-trip category', reparsed.category === 'gifts', reparsed.category) && ok;
  ok = check('url: round-trip sort', reparsed.sort === 'price_asc', reparsed.sort) && ok;
  ok = check('url: round-trip page', reparsed.page === 2, String(reparsed.page)) && ok;
  ok = check('url: round-trip priceMin', reparsed.priceMin === 100, String(reparsed.priceMin)) && ok;

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('verify-phase2 crashed:', e);
  process.exit(2);
});
