// HIRFA Phase 2A — public marketplace search.
// /craft/search?q=<text>&category=<slug>&area=<slug>&priceMin=&priceMax=&sort=<...>&page=N
//
// SSR, no auth. Direct URLs are first-class citizens: filters are parsed from
// searchParams by the SAME helper the public API uses (craft-search.ts), so an
// opened/pasted/shared URL reproduces the identical result set. The filter bar
// only ever pushes new URLs — there is no result state that lives only in React.
import { getLocale } from '@/lib/locale';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { db } from '@/lib/db';
import { marketplaceProductSelect, craftCategorySelect } from '@/lib/dto';
import {
  parseCraftSearchFilters,
  buildCraftSearchUrl,
  type CraftSearchFilters,
} from '@/lib/craft-search';
import {
  buildCraftProductWhere,
  buildCraftProductOrderBy,
  buildCraftStoreWhere,
} from '@/lib/craft-search-query';
import Link from 'next/link';
import { getStoreUrl } from '@/lib/craft-urls';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { LangToggle } from '@/components/wassilha/lang-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CartLink } from '@/components/wassilha/craft/cart-link';
import { SearchFilters, type FilterOption } from '@/components/wassilha/craft/search-filters';
import { ProductGrid } from '@/components/wassilha/craft/product-grid';

export const revalidate = 60;

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp);
  const t = getMarketplaceT(lang);
  const f = parseCraftSearchFilters(sp);
  const heading = f.q || t.searchTitle;
  const canonical = buildCraftSearchUrl(f);
  return {
    title: `${heading} · وَصِّلها`,
    description: t.searchHint,
    alternates: { canonical },
    openGraph: {
      title: heading,
      description: t.searchHint,
      url: canonical,
      siteName: 'WASSILHA',
      type: 'website',
    },
    robots: { index: true, follow: true },
  };
}

interface StoreHit {
  id: string;
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  _count: { products: number };
}

export default async function CraftSearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp) as 'ar' | 'fr';
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  const f = parseCraftSearchFilters(sp);

  const [categories, areas, products, total, storeHits] = await Promise.all([
    db.craftCategory.findMany({
      where: { isActive: true },
      select: craftCategorySelect,
      orderBy: { sortOrder: 'asc' },
    }),
    db.deliveryArea.findMany({
      where: { isActive: true },
      select: { slug: true, nameAr: true, nameFr: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.craftProduct.findMany({
      where: buildCraftProductWhere(f),
      select: marketplaceProductSelect,
      orderBy: buildCraftProductOrderBy(f.sort),
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    db.craftProduct.count({ where: buildCraftProductWhere(f) }),
    // Store results only make sense for a text query.
    f.q
      ? (db.artisanProfile.findMany({
          where: buildCraftStoreWhere(f),
          select: {
            id: true,
            slug: true,
            displayName: true,
            avatarUrl: true,
            _count: { select: { products: { where: { isActive: true } } } },
          },
          take: 6,
        }) as unknown as StoreHit[])
      : Promise.resolve([] as StoreHit[]),
  ]);

  const pages = Math.max(1, Math.ceil(total / f.pageSize));

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/craft" className="flex items-center gap-2">
            <BrandLogo size={32} />
          </Link>
          <nav className="flex items-center gap-2">
            <CartLink />
            <ThemeToggle />
            <LangToggle />
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-black text-foreground">{t.searchTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.searchHint}</p>

        <div className="mt-4">
          <SearchFilters
            initial={f}
            categories={categories as unknown as FilterOption[]}
            areas={areas as unknown as FilterOption[]}
            lang={lang}
          />
        </div>
      </section>

      {/* Matching stores (only for a text query) */}
      {storeHits.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-2">
          <h2 className="text-sm font-bold text-foreground">{t.searchStores}</h2>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {storeHits.map((s) => (
              <Link
                key={s.id}
                href={getStoreUrl(s.slug, s.id)}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted/50"
              >
                {s.avatarUrl ? (
                  <img
                    src={s.avatarUrl}
                    alt={s.displayName}
                    className="h-7 w-7 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {s.displayName.charAt(0)}
                  </span>
                )}
                <span className="max-w-[8rem] truncate">{s.displayName}</span>
                <span className="text-muted-foreground">{s._count?.products ?? 0}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-4 pb-10">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">
            {total} {t.resultsFound}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.page} {f.page}/{pages}
          </p>
        </div>

        {products.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
            <p className="text-sm font-black text-foreground">{t.noResults}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.noResultsDesc}</p>
            <Link
              href="/craft/search"
              className="mt-4 inline-flex items-center justify-center rounded-xl border border-primary/40 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/5"
            >
              {t.clearFilters}
            </Link>
          </div>
        ) : (
          <div className="mt-4">
            <ProductGrid products={products} lang={lang} />
          </div>
        )}

        <Pagination filters={f} pages={pages} t={t} isRtl={isRtl} />
      </section>
    </div>
  );
}

function Pagination({
  filters,
  pages,
  t,
  isRtl,
}: {
  filters: CraftSearchFilters;
  pages: number;
  t: ReturnType<typeof getMarketplaceT>;
  isRtl: boolean;
}) {
  if (pages <= 1) return null;
  const current = filters.page;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const numbers: number[] = [];
  for (let i = start; i <= end; i++) numbers.push(i);

  const baseBtn =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-bold transition-colors';
  const inactive = `${baseBtn} border-border bg-card text-foreground hover:bg-muted/50`;
  const active = `${baseBtn} border-primary bg-primary text-primary-foreground`;

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label={t.page}>
      {current > 1 && (
        <Link href={buildCraftSearchUrl({ ...filters, page: current - 1 })} className={inactive} rel="prev">
          {isRtl ? '→' : '←'} {t.prevPage}
        </Link>
      )}
      {numbers.map((n) => (
        <Link
          key={n}
          href={buildCraftSearchUrl({ ...filters, page: n })}
          aria-current={n === current ? 'page' : undefined}
          className={n === current ? active : inactive}
        >
          {n}
        </Link>
      ))}
      {current < pages && (
        <Link href={buildCraftSearchUrl({ ...filters, page: current + 1 })} className={inactive} rel="next">
          {t.nextPage} {isRtl ? '←' : '→'}
        </Link>
      )}
    </nav>
  );
}
