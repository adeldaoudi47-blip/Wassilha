// HIRFA Phase 2B — one-off backfill: give every ACTIVE artisan that somehow has
// no valid slug a stable one (the public store URL is unreachable without it).
// Idempotent + additive: it never touches a row that already has a valid slug,
// so no live URL can change. It does not delete or rewrite anything.
//
// Root cause was fixed at the source (admin approve route now guarantees a slug
// at publish time); this repairs rows that were already public without one.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const rows = await db.artisanProfile.findMany({
    where: { status: 'active' },
    select: { id: true, slug: true, displayName: true },
  });
  const bad = rows.filter((r) => !r.slug || r.slug.length < 2);
  console.log('active=' + rows.length + ' missingSlug=' + bad.length);
  for (const r of bad) {
    let base = slugifyLatin(r.displayName);
    if (!base) base = 'store-' + r.id.slice(0, 8).toLowerCase();
    let slug = base;
    let n = 2;
    while (await db.artisanProfile.findUnique({ where: { slug }, select: { id: true } })) {
      slug = base + '-' + n++;
    }
    await db.artisanProfile.update({ where: { id: r.id }, data: { slug } });
    console.log('  allocated "' + slug + '" for ' + r.displayName + ' (' + r.id + ')');
  }
  await db.$disconnect();
})();

// Mirrors src/lib/slug.ts (pure, no DB) so this script does not need a build.
function slugify(text) {
  if (!text) return null;
  const ARABIC_TO_LATIN = { 'ا':'a','ب':'b','ت':'t','ث':'s','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'d','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'3','غ':'g','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','و':'w','ه':'h','ي':'y','ة':'t','ى':'y','إ':'a','أ':'a','آ':'a','ؤ':'w','ئ':'y','ء':'' };
  const HARAKAT = /[\u064B-\u065F\u0670\u0640]/g;
  const cleaned = String(text).replace(HARAKAT, '');
  let latin = '';
  for (const ch of cleaned) {
    if (ARABIC_TO_LATIN[ch] !== undefined) latin += ARABIC_TO_LATIN[ch];
    else if (/[a-z0-9]/i.test(ch)) latin += ch;
    else latin += ' ';
  }
  const slug = latin.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug.length >= 2 ? slug : null;
}
function slugifyLatin(text) { return slugify(text); }
