// Public craft flow smoke (store -> product -> share/cart -> sitemap/robots).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const BASE = 'http://localhost:3000';
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? '  -> ' + extra : ''));
}
function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).toLowerCase();
}
async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, body: text };
}
(async () => {
  // ---- pages ----
  let r = await get('/craft');
  check('GET /craft -> 200', r.status === 200, 'status=' + r.status);
  r = await get('/craft/search');
  check('GET /craft/search -> 200', r.status === 200, 'status=' + r.status);

  // ---- every ACTIVE store resolves on its canonical slug ----
  const artisans = await db.artisanProfile.findMany({
    where: { status: 'active' },
    select: { id: true, displayName: true, slug: true },
  });
  const slugless = artisans.filter((a) => !a.slug || a.slug.length < 2);
  for (const a of slugless) {
    r = await get('/craft/' + encodeURIComponent(slugify(a.displayName)));
    check('slugless store ' + a.displayName + ' -> resolves', r.status === 200, 'status=' + r.status);
  }
  for (const a of artisans.filter((a) => a.slug && a.slug.length >= 2)) {
    r = await get('/craft/' + encodeURIComponent(a.slug));
    check('store /craft/' + a.slug + ' -> 200', r.status === 200, 'status=' + r.status);
    if (r.status === 200) {
      check('  page contains store displayName', r.body.includes(a.displayName));
    }
  }

  // ---- every ACTIVE product resolves on its canonical URL ----
  const products = await db.craftProduct.findMany({
    where: { isActive: true, artisan: { status: 'active' } },
    select: { id: true, slug: true, nameAr: true, artisan: { select: { id: true, slug: true } } },
  });
  for (const p of products) {
    const storeSlug = p.artisan.slug && p.artisan.slug.length >= 2 ? p.artisan.slug : 'store-' + p.artisan.id.slice(0, 8);
    const pSlug = p.slug && p.slug.length >= 2 ? p.slug : 'product-' + p.id.slice(0, 8);
    r = await get('/craft/' + encodeURIComponent(storeSlug) + '/product/' + encodeURIComponent(pSlug));
    check('product ' + p.nameAr + ' -> 200', r.status === 200, 'status=' + r.status + ' url=' + pSlug);
  }

  // ---- public APIs ----
  r = await get('/api/craft/marketplace/products');
  const hasItems = r.status === 200 && r.body.includes('"products"');
  check('GET /api/craft/marketplace/products -> 200', hasItems, 'status=' + r.status);

  // ---- seo ----
  r = await get('/sitemap.xml');
  check('GET /sitemap.xml -> 200', r.status === 200, 'status=' + r.status);
  if (r.status === 200) check('  sitemap lists a craft store', r.body.includes('/craft/'));
  r = await get('/robots.txt');
  check('GET /robots.txt -> 200', r.status === 200, 'status=' + r.status);
  if (r.status === 200) check('  robots allows all', /Allow: \//.test(r.body));

  const pass = results.filter((x) => x.ok).length;
  console.log('\n=== PUBLIC SMOKE: ' + pass + '/' + results.length + ' passed ===');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
