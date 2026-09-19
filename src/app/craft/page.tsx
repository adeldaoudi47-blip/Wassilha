// HIRFAA Phase 1 — Public marketplace page.
// /craft  →  SSR, SEO-friendly, no auth required.
// Reuses the existing Craft API/DTOs (marketplaceProductSelect) and the
// current BrandLogo / i18n posture. No fake data: every item comes from the
// live DB through the public projections.
import { getLocale } from '@/lib/locale';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { getStoreUrl } from '@/lib/craft-urls';
import { db } from '@/lib/db';
import { marketplaceProductSelect, craftCategorySelect } from '@/lib/dto';
import Link from 'next/link';
import Image from 'next/image';
import { Search, Star } from 'lucide-react';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { LangToggle } from '@/components/wassilha/lang-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CartLink } from '@/components/wassilha/craft/cart-link';

export const revalidate = 60; // ISR: 1 min

interface StoreTile {
  id: string;
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  totalSales: number;
  productCount: number;
  area: { nameAr: string; nameFr: string | null } | null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ lang?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp);
  const t = getMarketplaceT(lang);
  return {
    title: `${t.discoverCrafts} · وَصِّلها`,
    description: t.discoverCrafts,
    alternates: { canonical: '/craft' },
    openGraph: {
      title: t.discoverCrafts,
      description: t.discoverCrafts,
      url: '/craft',
      siteName: 'WASSILHA',
      type: 'website',
    },
    robots: { index: true, follow: true },
  };
}

async function loadMarketplace() {
  const [categories, featured, latest, stores] = await Promise.all([
    db.craftCategory.findMany({
      where: { isActive: true },
      select: craftCategorySelect,
      orderBy: { sortOrder: 'asc' },
    }),
    db.craftProduct.findMany({
      where: { isActive: true, isFeatured: true, artisan: { status: 'active' } },
      select: marketplaceProductSelect,
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    db.craftProduct.findMany({
      where: { isActive: true, artisan: { status: 'active' } },
      select: marketplaceProductSelect,
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    db.artisanProfile.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        slug: true,
        displayName: true,
        avatarUrl: true,
        rating: true,
        totalSales: true,
        area: { select: { nameAr: true, nameFr: true } },
        _count: { select: { products: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }) as unknown as StoreTile[],
  ]);

    return { categories, featured, latest, stores };
}

export default async function CraftMarketplacePage({
  searchParams,
}: {
  searchParams?: Promise<{ lang?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp) as 'ar' | 'fr';
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  const data = await loadMarketplace();

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      {/* Header (reuses BrandLogo + language/theme toggles) */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size={32} />
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/craft/search"
              className="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label={t.searchTitle}
            >
              <Search size={18} />
            </Link>
            <CartLink />
            <ThemeToggle />
            <LangToggle />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {t.discoverCrafts}
        </h1>
        <p className="mt-3 text-muted-foreground">وَصِّلها — إبداعات الجزائر والمقاطعة</p>
        <Link
          href="#stores"
          className="mt-6 inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-sm font-black text-primary-foreground shadow-lg transition hover:bg-brand-dark"
        >
          {t.exploreNow}
        </Link>
      </section>

      {/* Categories */}
      {data.categories.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-6">
          <h2 className="text-lg font-bold text-foreground">{t.shopByCategory}</h2>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-2">
            {data.categories.map((c) => (
              <Link
                key={c.id}
                href={c.slug ? `/craft/search?category=${encodeURIComponent(c.slug)}` : '/craft/search'}
                className="shrink-0 rounded-xl border border-border px-4 py-2.5 text-center text-sm font-semibold hover:bg-muted"
              >
                {isRtl ? c.nameAr : (c.nameFr || c.nameAr)}
              </Link>
            ))}
          </nav>
        </section>
      )}

      {/* Featured */}
      {data.featured.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-6">
          <h2 className="text-lg font-bold text-foreground">{t.featured}</h2>
          <ProductGrid products={data.featured} lang={lang} />
        </section>
      )}

      {/* Latest */}
      {data.latest.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-6">
          <h2 className="text-lg font-bold text-foreground">{t.latest}</h2>
          <ProductGrid products={data.latest} lang={lang} />
        </section>
      )}

      {/* Stores */}
      <section id="stores" className="mx-auto max-w-3xl px-4 py-8">
        <h2 className="text-lg font-bold text-foreground">{t.storesTitle}</h2>
        {data.stores.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t.noStores}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.stores.map((s) => (
              <Link
                key={s.id}
                href={getStoreUrl(s.slug, s.id)}
                className="group block rounded-xl border border-border p-3 text-center transition hover:bg-muted/50"
              >
                <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border">
                  {s.avatarUrl ? (
                    <Image
                      src={s.avatarUrl}
                      alt={s.displayName}
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xl font-black text-primary">
                      {s.displayName.charAt(0)}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm font-bold">{s.displayName}</p>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                  <Star size={11} className="fill-amber-400 text-amber-400" />
                  <span className="font-bold text-foreground">{s.rating.toFixed(1)}</span>
                  <span className="opacity-50">·</span>
                  <span>
                    {s.productCount}{' '}
                    {s.productCount === 1 ? t.productCountOne : t.productCount}
                  </span>
                </div>
                <span className="mt-1.5 inline-block text-[11px] font-bold text-primary underline-offset-2 group-hover:underline">
                  {t.visitStore}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProductGrid({ products, lang }: { products: any[]; lang: 'ar' | 'fr' }) {
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((p) => {
        const storeKey =
          p.artisan?.slug && p.artisan.slug.length >= 2
            ? p.artisan.slug
            : `store-${(p.artisan?.id || p.id).slice(0, 8)}`;
        const productKey =
          p.slug && p.slug.length >= 2 ? p.slug : `product-${p.id.slice(0, 8)}`;
        const url = `/craft/${encodeURIComponent(storeKey)}/product/${encodeURIComponent(productKey)}`;
        return (
          <Link key={p.id} href={url} className="group block">
            <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-xl border border-border">
              {p.images?.[0] ? (
                <Image
                  src={p.images[0]}
                  alt={isRtl ? p.nameAr : (p.nameFr || p.nameAr)}
                  fill
                  className="object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted/30">
                  <span className="text-xs text-muted-foreground">{t.store}</span>
                </div>
              )}
              {p.isFeatured && (
                <span className="absolute top-1.5 text-[9px] font-black uppercase text-white bg-primary/80 rounded px-1.5 py-0.5">
                  {t.featured}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm font-bold leading-tight">
              {isRtl ? p.nameAr : (p.nameFr || p.nameAr)}
            </p>
            <p className="text-sm text-foreground">
              {p.price.toLocaleString('fr-DZ')} د.ج
            </p>
          </Link>
        );
      })}
    </div>
  );
}


