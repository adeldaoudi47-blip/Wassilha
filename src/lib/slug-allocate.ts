import { db } from './db';
import { artisanSlugBase, productSlugBase } from './slug';

// HIRFA Phase 1 — server-side slug allocation helpers (DB-aware).
// Base slug comes from the display/product name; on collision a numeric
// suffix (-2, -3, ...) is appended. Generation happens ONCE; the value is
// never regenerated afterwards, keeping public URLs stable for life.

export async function allocateStoreSlug(displayName: string, id: string): Promise<string> {
  const base = artisanSlugBase(displayName, id.slice(0, 8).toLowerCase());
  let slug = base;
  let n = 2;
  while (await db.artisanProfile.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export async function allocateProductSlug(
  name: string | null,
  artisanId: string,
  id: string
): Promise<string> {
  const base = productSlugBase(name, id.slice(0, 8).toLowerCase());
  let slug = base;
  let n = 2;
  while (await db.craftProduct.findFirst({ where: { artisanId, slug }, select: { id: true } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
