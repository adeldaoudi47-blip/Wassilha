/**
 * HIRFAA Phase 1 — idempotent slug backfill for EXISTING stores & products.
 *
 * GO/NO-GO SAFETY (matches the Phase-1 contract):
 *  - NEVER changes displayName, nameAr, owner, prices, order, or review data.
 *  - NEVER deletes records.
 *  - Idempotent: re-running is a no-op for rows that already have a slug.
 *  - Resolves UNIQUE conflicts by appending "-N"; never overwrites an
 *    existing slug, so a stable URL once assigned never changes.
 *
 * Run with:  npx tsx src/scripts/backfill-slugs.ts
 */
import { db } from '@/lib/db';
import { artisanSlugBase, productSlugBase } from '@/lib/slug';
import { Prisma } from '@prisma/client';

async function main() {
  // ---- ARTISAN PROFILES (stores) ----
  const pendingArtisans = await db.artisanProfile.findMany({
    where: { slug: null },
    select: { id: true, displayName: true },
  });
  console.log(`[artisan] ${pendingArtisans.length} profiles without slug`);

  for (const a of pendingArtisans) {
    const idPrefix = a.id.slice(0, 8);
    const base = artisanSlugBase(a.displayName, idPrefix);
    const slug = await uniqueArtisanSlug(base, idPrefix);
    await db.artisanProfile.update({ where: { id: a.id }, data: { slug } });
    console.log(`[artisan] ${a.id} -> /craft/${slug}`);
  }

  // ---- CRAFT PRODUCTS ----
  const pendingProducts = await db.craftProduct.findMany({
    where: { slug: null },
    select: { id: true, nameAr: true, artisanId: true },
  });
  console.log(`[product] ${pendingProducts.length} products without slug`);

  for (const p of pendingProducts) {
    const idPrefix = p.id.slice(0, 8);
    const base = productSlugBase(p.nameAr, idPrefix);
    const slug = await uniqueProductSlug(base, idPrefix, p.artisanId);
    await db.craftProduct.update({ where: { id: p.id }, data: { slug } });
    console.log(`[product] ${p.id} (artisan ${p.artisanId}) -> ${slug}`);
  }

  console.log('BACKFILL_DONE');
}

async function uniqueArtisanSlug(base: string, idPrefix: string): Promise<string> {
  let candidate = base;
  let i = 2;
  for (;;) {
    try {
      // Probe existence without a unique-constraint error.
      const exists = await db.artisanProfile.count({ where: { slug: candidate } });
      if (exists === 0) return candidate;
      candidate = `${base}-${i}`;
      i++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        candidate = `${base}-${i}`;
        i++;
      } else {
        throw e;
      }
    }
  }
}

async function uniqueProductSlug(base: string, idPrefix: string, artisanId: string): Promise<string> {
  let candidate = base;
  let i = 2;
  for (;;) {
    const exists = await db.craftProduct.count({ where: { artisanId, slug: candidate } });
    if (exists === 0) return candidate;
    candidate = `${base}-${i}`;
    i++;
  }
}

main()
  .catch((e) => {
    console.error('BACKFILL_ERROR', e);
    process.exit(1);
  });
