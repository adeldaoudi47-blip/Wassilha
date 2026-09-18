// Phase 2C audit: public store + product + SEO checks. READ-ONLY vs DB.
// Usage: node src/scripts/audit-public.cjs
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';

function code(s) {
  return s
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

async function head(path) {
  // use GET but only read status + content-type via curl to avoid big bodies
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync(
      'curl',
      ['-s', '-o', 'NUL', '-w', '%{http_code}|%{content_type}', BASE + path],
      { encoding: 'utf8', timeout: 30000 }
    );
    const [status, type] = out.split('|');
    return { status: Number(status), type };
  } catch (e) {
    return { status: 0, type: 'err' };
  }
}

(async () => {
  const artisans = await db.artisanProfile.findMany({
    where: { status: 'active' },
    select: { id: true, displayName: true, slug: true, status: true, _count: { select: { products: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log('=== ACTIVE STORES: ' + artisans.length + ' ===');
  let storeOk = 0, storeFail = 0;
  for (const a of artisans) {
    const slug = a.slug && a.slug.length >= 2 ? a.slug : `store-${a.id.slice(0, 8)}`;
    const r = await head('/craft/' + slug);
    const ok = r.status === 200;
    if (ok) storeOk++; else storeFail++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(4)} /craft/${slug}  products=${a._count.products}  ${code(a.displayName)}`);
  }

  const products = await db.craftProduct.findMany({
    where: { isActive: true },
    include: { artisan: { select: { id: true, slug: true, displayName: true, status: true } }, category: { select: { nameAr: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n=== ACTIVE PRODUCTS: ' + products.length + ' ===');
  let prodOk = 0, prodFail = 0, noCat = 0, noSlug = 0, noImg = 0, zeroStock = 0;
  for (const p of products) {
    const sSlug = p.artisan.slug && p.artisan.slug.length >= 2 ? p.artisan.slug : `store-${p.artisan.id.slice(0, 8)}`;
    const pSlug = p.slug && p.slug.length >= 2 ? p.slug : `product-${p.id.slice(0, 8)}`;
    const r = await head(`/craft/${sSlug}/product/${pSlug}`);
    const ok = r.status === 200;
    if (ok) prodOk++; else prodFail++;
    if (!p.slug) noSlug++;
    if (!p.category) noCat++;
    if (!p.images || p.images.length === 0) noImg++;
    if (p.stock <= 0) zeroStock++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(4)} /craft/${sSlug}/product/${pSlug}  ${p.price}DZD x${p.stock}  imgs=${p.images.length}  cat=${p.category ? code(p.category.nameAr) : 'NULL'}  ${code(p.nameAr)}`);
  }

  // duplicate slug check (within store)
  const seen = new Map();
  let dup = 0;
  for (const p of products) {
    if (!p.slug) continue;
    const k = p.artisanId + '|' + p.slug;
    if (seen.has(k)) { dup++; console.log('DUP-SLUG ' + k); }
    seen.set(k, true);
  }

  console.log('\n=== SUMMARY ===');
  console.log('stores http200=' + storeOk + ' fail=' + storeFail);
  console.log('products http200=' + prodOk + ' fail=' + prodFail);
  console.log('products missing slug=' + noSlug + ' missing category=' + noCat + ' missing images=' + noImg + ' zero stock=' + zeroStock + ' dup slugs=' + dup);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
