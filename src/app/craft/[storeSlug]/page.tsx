// HIRFAA Phase 1 — Public storefront page.
// /craft/[storeSlug]  →  SSR, SEO-friendly, no auth required.
import { getLocale } from '@/lib/locale';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { db } from '@/lib/db';
import { marketplaceProductSelect, publicArtisanStoreSelect } from '@/lib/dto';
import { getStoreAbsoluteUrl, getProductUrl } from '@/lib/craft-urls';
import { absoluteUrl } from '@/lib/site';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { LangToggle } from '@/components/wassilha/lang-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CartLink } from '@/components/wassilha/craft/cart-link';
import { ShareButton } from '@/components/wassilha/craft/share-button';
import { TrackView } from '@/components/wassilha/craft/track-view';
import type { Lang } from '@/lib/types';
import type { StoreFront, ProductTile } from '@/lib/marketplace-types';

export const revalidate = 60;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams?: Promise<{ lang?: string }>;
}) {
  const { storeSlug } = await params;
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp);
  const t = getMarketplaceT(lang);
  const store = await loadStore(storeSlug);
  const title = store ? `${store.displayName} · ${t.store} · وَصِّلها` : 'وَصِّلها · متجر';
  const description = store
    ? (lang === 'fr' ? store.bioFr : store.bioAr) || t.discoverCrafts
    : t.discoverCrafts;
  const storeKey = store?.slug ?? storeSlug;
  // Phase 2A: dedicated dynamic OG image (name + bio + branding + avatar),
  // Arabic-aware; the OG route itself redirects to the raw avatar on error.
  const ogImage = absoluteUrl(`/craft/${storeKey}/og`);
  return {
    title,
    description,
    alternates: { canonical: `/craft/${storeKey}` },
    openGraph: {
      title,
      description,
      url: `/craft/${storeKey}`,
      siteName: 'WASSILHA',
      type: 'profile',
      images: store
        ? [
            { url: ogImage, width: 1200, height: 630, alt: store.displayName },
            ...(store.avatarUrl ? [{ url: store.avatarUrl }] : []),
          ]
        : undefined,
    },
    twitter: store
      ? { card: 'summary_large_image', title, description, images: [ogImage] }
      : undefined,
    robots: { index: true, follow: true },
  };
}

async function loadStore(storeSlug: string): Promise<StoreFront | null> {
  const row = await db.artisanProfile.findUnique({
    where: { slug: storeSlug },
    select: {
      ...publicArtisanStoreSelect,
      status: true,
      products: {
        where: { isActive: true },
        select: marketplaceProductSelect,
        orderBy: { createdAt: 'desc' },
        take: 24,
      },
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
  if (!row || row.status !== 'active') return null;
  const { products, _count, status, ...store } = row;
  return { ...store, products, productCount: _count.products };
}

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams?: Promise<{ lang?: string }>;
}) {
  const { storeSlug } = await params;
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp) as 'ar' | 'fr';
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  const store = await loadStore(storeSlug);

  // Unknown / inactive / pending stores must 404 for crawlers & users alike.
  if (!store) notFound();

  const storeUrl = getStoreAbsoluteUrl(store.slug, store.id);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      {/* Phase 2A: count this real browser visit (anonymous, PII-free).
          Rendered once per mount; see track-view.tsx. */}
      <TrackView storeId={store.id} />
      {/* Public header — same branding posture as the marketplace page */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/craft" aria-label="WASSILHA">
            <BrandLogo size={36} />
          </Link>
          <div className="min-w-0 flex-1" />
          <CartLink />
          <ThemeToggle />
          <LangToggle />
        </div>
      </header>

      {/* Store hero */}
      <section className="mx-auto max-w-3xl px-4 pt-6">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
              {store.avatarUrl ? (
                <img src={store.avatarUrl} alt={store.displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-black text-primary">{store.displayName.charAt(0)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black leading-tight text-foreground">{store.displayName}</h1>
              {(lang === 'fr' ? store.bioFr : store.bioAr) && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {lang === 'fr' ? store.bioFr : store.bioAr}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {store.area && <span>📍 {isRtl ? store.area.nameAr : store.area.nameFr || store.area.nameAr}</span>}
                <span>⭐ {store.rating.toFixed(1)}</span>
                <span>
                  🛍️ {store.productCount} {store.productCount === 1 ? t.productCountOne : t.productCount}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <ShareButton
              lang={lang}
              label={t.shareStore}
              analytics={{ storeId: store.id }}
              target={{
                title: store.displayName,
                // Phase 2C: aligned store share copy (matches the product copy
                // and the marketplace wording sellers already know).
                text: isRtl
                  ? `شوفوا متجري في ركن حرفة 👇 ${store.displayName}`
                  : `Découvrez ma boutique dans le coin de l'artisanat 👇 ${store.displayName}`,
                url: storeUrl,
              }}
            />
          </div>
        </div>
      </section>

      {/* Products — active only (guaranteed by loadStore) */}
      <section className="mx-auto max-w-3xl px-4 py-6">
        {store.products.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t.storeEmpty}</p>
        ) : (
          <ProductGrid products={store.products} lang={lang} />
        )}
      </section>

      {/* JSON-LD: only fields we actually have — never invented */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: store.displayName,
            ...(store.avatarUrl ? { image: store.avatarUrl } : {}),
            ...(store.area
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    addressLocality: isRtl ? store.area.nameAr : store.area.nameFr || store.area.nameAr,
                    addressCountry: 'DZ',
                  },
                }
              : {}),
            url: storeUrl,
          }),
        }}
      />
    </div>
  );
}

function ProductGrid({ products, lang }: { products: ProductTile[]; lang: 'ar' | 'fr' }) {
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((p) => {
        const url = getProductUrl(p.artisan?.slug ?? null, p.slug, p.id, p.artisan?.id);
        return (
          <Link key={p.id} href={url} className="group block">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted/30">
              {p.images?.[0] ? (
                <img
                  src={p.images[0]}
                  alt={isRtl ? p.nameAr : p.nameFr || p.nameAr}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground/40">🧶</div>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm font-bold leading-tight">
              {isRtl ? p.nameAr : p.nameFr || p.nameAr}
            </p>
            <p className="text-sm font-extrabold text-primary">
              {p.price.toLocaleString('fr-DZ')} {isRtl ? 'د.ج' : 'DZD'}
            </p>
            {p.stock <= 0 && <p className="text-[10px] font-bold text-destructive">{t.outOfStock}</p>}
          </Link>
        );
      })}
    </div>
  );
}
