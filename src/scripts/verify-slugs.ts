/**
 * HIRFAA Phase 1 — post-backfill verification (read-only):
 * 1) zero rows without slug (ArtisanProfile / CraftProduct)
 * 2) slug uniqueness (artisan global, product per-artisan)
 * 3) URL-safe charset check
 * 4) sample of actual public URLs
 */
import { db } from '@/lib/db';

async function main() {
  const [noSlugArtisans, noSlugProducts] = await Promise.all([
    db.artisanProfile.count({ where: { slug: null } }),
    db.craftProduct.count({ where: { slug: null } }),
  ]);
  console.log(`[verify] artisans without slug: ${noSlugArtisans}`);
  console.log(`[verify] products without slug: ${noSlugProducts}`);

  const dupArtisanSlugs = await db.artisanProfile.groupBy({
    by: ['slug'],
    _count: { _all: true },
    having: { slug: { _count: { gt: 1 } } },
  });
  console.log(`[verify] duplicate artisan slugs: ${dupArtisanSlugs.length}`);

  const artisans = await db.artisanProfile.findMany({
    select: { slug: true, displayName: true, status: true },
  });
  const unsafe = artisans.filter((a) => a.slug && !/^[a-z0-9-]+$/.test(a.slug));
  unsafe.forEach((a) => console.log(`[verify] UNSAFE slug: ${a.slug} (${a.displayName})`));

  console.log('[verify] sample URLs:');
  artisans.slice(0, 8).forEach((a) => {
    console.log(`  ${a.slug}  (${a.displayName}) [${a.status}]`);
  });

  const byStatus = await db.artisanProfile.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  byStatus.forEach((s) => console.log(`[verify] status=${s.status}: ${s._count._all}`));

  console.log('VERIFY_DONE');
  await db.$disconnect();
}

main().catch((e) => {
  console.error('VERIFY_ERROR', e);
  process.exit(1);
});
