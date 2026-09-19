// HIRFA Phase 1 — Public product page.
// /craft/[storeSlug]/product/[productSlug] → SSR, SEO + OG + JSON-LD, no auth.
// Reuses the existing useCraftCart store via PublicAddToCart (no cart redesign).
import { getLocale } from '@/lib/locale';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { db } from '@/lib/db';
import { getProductAbsoluteUrl, getStoreUrl } from '@/lib/craft-urls';
import { SITE_URL, absoluteUrl } from '@/lib/site';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { LangToggle } from '@/components/wassilha/lang-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CartLink } from '@/components/wassilha/craft/cart-link';
import { ShareButton } from '@/components/wassilha/craft/share-button';
import { PublicAddToCart } from '@/components/wassilha/craft/public-add-to-cart';
import { TrackView } from '@/components/wassilha/craft/track-view';

export const revalidate = 60;

interface LoadedProduct {
  id: string;
  slug: string | null;
  nameAr: string;
  nameFr: string | null;
  descriptionAr: string | null;
  descriptionFr: string | null;
  price: number;
  images: string[];
  stock: number;
  isMadeToOrder: boolean;
  category: { nameAr: string; nameFr: string | null } | null;
  store: { id: string; slug: string | null; displayName: string; avatarUrl: string | null; rating: number };
}

async function loadProduct(storeSlug: string, productSlug: string): Promise<LoadedProduct | null> {
  const artisan = await db.artisanProfile.findFirst({
    where: {
      OR: [{ slug: storeSlug }, { id: { startsWith: storeSlug.replace(/^store-/, '') } }],
    },
    select: { id: true, slug: true, displayName: true, avatarUrl: true, rating: true, status: true },
  });
  if (!artisan || artisan.status !== 'active') return null;

  const product = await db.craftProduct.findFirst({
    where: {
      artisanId: artisan.id,
      isActive: true,
      OR: [{ slug: productSlug }, { id: { startsWith: productSlug.replace(/^product-/, '') } }],
    },
    select: {
      id: true,
      slug: true,
      nameAr: true,
      nameFr: true,
      descriptionAr: true,
      descriptionFr: true,
      price: true,
      images: true,
      stock: true,
      isMadeToOrder: true,
      category: { select: { nameAr: true, nameFr: true } },
    },
  });
  if (!product) return null;

  return {
    ...product,
    store: {
      id: artisan.id,
      slug: artisan.slug,
      displayName: artisan.displayName,
      avatarUrl: artisan.avatarUrl,
      rating: artisan.rating,
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string; productSlug: string }>;
  searchParams?: Promise<{ lang?: string }>;
}) {
  const { storeSlug, productSlug } = await params;
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp);
  const t = getMarketplaceT(lang);
  const p = await loadProduct(storeSlug, productSlug);
  if (!p) {
    return { title: `وَصِّلها · ${t.store}`, robots: { index: false, follow: false } };
  }
  const name = lang === 'fr' ? p.nameFr || p.nameAr : p.nameAr;
  const description =
    (lang === 'fr' ? p.descriptionFr : p.descriptionAr)?.slice(0, 160) ||
    `${name} · ${p.store.displayName} · ${t.discoverCrafts}`;
  const url = getProductAbsoluteUrl(p.store.slug, p.slug, p.id, p.store.id);
  const rawImage = p.images?.[0] ? p.images[0] : `${SITE_URL}/logo.png`;
  const storeKey = p.store.slug && p.store.slug.length >= 2 ? p.store.slug : `store-${p.store.id.slice(0, 8)}`;
  const productKey = p.slug && p.slug.length >= 2 ? p.slug : `product-${p.id.slice(0, 8)}`;
  // Phase 2A: dedicated dynamic OG image (name + price + store + photo),
  // Arabic-aware. Falls back to the raw photo inside the OG route itself.
  const ogImage = absoluteUrl(`/craft/${storeKey}/product/${productKey}/og`);
  return {
    title: `${name} · ${p.store.displayName} · وَصِّلها`,
    description,
    alternates: { canonical: `/craft/${storeKey}/product/${productKey}` },
    openGraph: {
      title: name,
      description,
      url,
      siteName: 'WASSILHA',
      type: 'website',
      images: [
        { url: ogImage, width: 1200, height: 630, alt: name },
        // Raw photo kept as a second entry: platforms that do not follow the
        // OG route's redirect still get a real product picture.
        { url: rawImage },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      description,
      images: [ogImage, rawImage],
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string; productSlug: string }>;
  searchParams?: Promise<{ lang?: string }>;
}) {
  const { storeSlug, productSlug } = await params;
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp) as 'ar' | 'fr';
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  const p = await loadProduct(storeSlug, productSlug);

  // Unknown / inactive product (or store) → real 404 for users & crawlers.
  if (!p) notFound();

  const name = isRtl ? p.nameAr : p.nameFr || p.nameAr;
  const description = isRtl ? p.descriptionAr : p.descriptionFr || p.descriptionAr;
  const productUrl = getProductAbsoluteUrl(p.store.slug, p.slug, p.id, p.store.id);
  const storeHref = getStoreUrl(p.store.slug, p.store.id);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      {/* Phase 2A: count this real product visit (anonymous, PII-free). */}
      <TrackView storeId={p.store.id} productId={p.id} />
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

      <main className="mx-auto max-w-3xl px-4 py-6">
        {/* Gallery — hero image + thumbnails */}
        <div className="space-y-2">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted/30">
            {p.images?.[0] ? (
               
              <img src={p.images[0]} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-6xl text-muted-foreground/30">🧶</div>
            )}
          </div>
          {p.images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {p.images.slice(1, 6).map((img, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  { }
                  <img src={img} alt={`${name} ${i + 2}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-5 space-y-3">
          <div>
            {p.category && (
              <p className="text-xs font-bold text-muted-foreground">
                {isRtl ? p.category.nameAr : p.category.nameFr || p.category.nameAr}
              </p>
            )}
            <h1 className="mt-0.5 text-xl font-black leading-tight">{name}</h1>
          </div>
          <p className="text-2xl font-black text-primary">
            {p.price.toLocaleString('fr-DZ')} {isRtl ? 'د.ج' : 'DZD'}
          </p>
          <p className={`text-xs font-bold ${p.isMadeToOrder || p.stock > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
            {p.isMadeToOrder
              ? t.madeToOrder
              : p.stock > 0
                ? `${t.inStock} (${p.stock})`
                : t.outOfStock}
          </p>

          {description && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}

          {/* Store attribution */}
          <Link
            href={storeHref}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition hover:bg-muted/50"
          >
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-muted">
              {p.store.avatarUrl ? (
                 
                <img src={p.store.avatarUrl} alt={p.store.displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-black text-primary">{p.store.displayName.charAt(0)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{p.store.displayName}</p>
              <p className="text-xs text-muted-foreground">⭐ {p.store.rating.toFixed(1)} · {t.store}</p>
            </div>
          </Link>

          {/* Cart — reuses the existing Zustand cart (works for guests) */}
          <PublicAddToCart
            lang={lang}
            storeSlug={p.store.slug || `store-${p.store.id.slice(0, 8)}`}
            productSlug={p.slug || `product-${p.id.slice(0, 8)}`}
            product={{ productId: p.id, nameAr: p.nameAr, price: p.price, image: p.images?.[0], stock: p.stock, isMadeToOrder: p.isMadeToOrder }}
          />

          <ShareButton
            lang={lang}
            label={t.shareProduct}
            analytics={{ storeId: p.store.id, productId: p.id }}
            target={{
              title: name,
              text: isRtl
                ? `شوف هذا المنتج من ركن حرفة 👇 ${name}`
                : `Découvrez ce produit artisanal : ${name}`,
              url: productUrl,
            }}
          />
        </div>
      </main>

      {/* JSON-LD Product — only real data, nothing invented */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name,
            ...(p.images?.[0] ? { image: p.images[0] } : {}),
            ...(description ? { description: description.slice(0, 300) } : {}),
            ...(p.category
              ? { category: isRtl ? p.category.nameAr : p.category.nameFr || p.category.nameAr }
              : {}),
            brand: { '@type': 'Brand', name: p.store.displayName },
            offers: {
              '@type': 'Offer',
              url: productUrl,
              priceCurrency: 'DZD',
              price: p.price,
              availability: p.isMadeToOrder || p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            },
          }),
        }}
      />
    </div>
  );
}

