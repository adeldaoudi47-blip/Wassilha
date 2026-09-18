// HIRFA Phase 2C — one-off backfill: give every ACTIVE product with slug = NULL
// a stable public slug, using the SAME allocator as the live create path
// (allocateProductSlug from @/lib/slug-allocate), so backfilled rows get exactly
// the slug they would have had at creation.
//
// SAFETY CONTRACT:
//  - Touches ONLY rows where slug IS NULL (idempotent: re-run is a no-op).
//  - Writes ONLY the `slug` column. Never name/price/stock/images/category/artisan.
//  - Never deletes or duplicates records; never overwrites an existing slug.
import { db } from '@/lib/db';
import { allocateProductSlug } from '@/lib/slug-allocate';

async function main() {
  const pending = await db.craftProduct.findMany({
    where: { slug: null },
    select: { id: true, nameAr: true, artisanId: true },
  });
  console.log(`[product] ${pending.length} products without slug`);

  for (const p of pending) {
    const slug = await allocateProductSlug(p.nameAr, p.artisanId, p.id);
    await db.craftProduct.update({ where: { id: p.id }, data: { slug } });
    console.log(`[product] ${p.id} "${p.nameAr}" -> ${slug}`);
  }
  console.log('BACKFILL_DONE');
}

main().catch((e) => {
  console.error('BACKFILL_ERROR', e);
  process.exit(1);
});
