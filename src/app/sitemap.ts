// HIRFA Phase 2A — dynamic sitemap (app/sitemap.ts → /sitemap.xml).
//
// ONLY public, indexable content is listed:
//   /craft                        (the marketplace itself)
//   /craft/<storeSlug>            for every ACTIVE store with a slug
//   /craft/<storeSlug>/product/<productSlug>  for every ACTIVE product of an
//                                              ACTIVE store, with a slug
//
// Deliberately excluded: pending/rejected stores, inactive products, admin,
// dashboard, account and API routes (see app/robots.ts).
//
// `revalidate` keeps the sitemap fresh without rebuilding: the store/product
// set changes as sellers publish, and 5 minutes is a good freshness/cost ratio.
import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { absoluteUrl } from '@/lib/site';

export const revalidate = 300; // 5 minutes

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [stores, products] = await Promise.all([
    db.artisanProfile.findMany({
      where: { status: 'active', slug: { not: null } },
      select: { slug: true, createdAt: true, updatedAt: true },
    }),
    db.craftProduct.findMany({
      where: { isActive: true, slug: { not: null }, artisan: { status: 'active' } },
      select: { slug: true, createdAt: true, updatedAt: true, artisan: { select: { slug: true } } },
    }),
  ]);

  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl('/craft'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: { languages: { ar: absoluteUrl('/craft'), fr: absoluteUrl('/craft?lang=fr') } },
    },
  ];

  for (const s of stores) {
    if (!s.slug) continue; // defensive: only stable, slugged public URLs
    const path = `/craft/${encodeURIComponent(s.slug)}`;
    entries.push({
      url: absoluteUrl(path),
      lastModified: s.updatedAt ?? s.createdAt,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { ar: absoluteUrl(path), fr: absoluteUrl(`${path}?lang=fr`) } },
    });
  }

  for (const p of products) {
    if (!p.slug || !p.artisan.slug) continue;
    const path = `/craft/${encodeURIComponent(p.artisan.slug)}/product/${encodeURIComponent(p.slug)}`;
    entries.push({
      url: absoluteUrl(path),
      lastModified: p.updatedAt ?? p.createdAt,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: { languages: { ar: absoluteUrl(path), fr: absoluteUrl(`${path}?lang=fr`) } },
    });
  }

  return entries;
}
