// HIRFA Phase 2A — shared public product grid (server component).
//
// Renders product tiles exactly like /craft does: image, name, price in د.ج,
// featured chip, out-of-stock note. Links use the stable slug URLs with the
// same fallback logic as craft-urls.ts. No client JS.
import Link from 'next/link';
import Image from 'next/image';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import type { Lang } from '@/lib/types';
import type { ProductTile } from '@/lib/marketplace-types';

interface ProductGridProps {
  products: ProductTile[];
  lang: 'ar' | 'fr';
  /** Skeleton columns; defaults to the marketplace layout. */
  className?: string;
}

export function ProductGrid({ products, lang, className }: ProductGridProps) {
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  return (
    <div className={className ?? 'grid grid-cols-2 gap-3 sm:grid-cols-3'}>
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
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted/30">
              {p.images?.[0] ? (
                <Image
                  src={p.images[0]}
                  alt={isRtl ? p.nameAr : p.nameFr || p.nameAr}
                  fill
                  className="object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground/40">
                  🧶
                </div>
              )}
              {p.isFeatured && (
                <span className="absolute top-1.5 text-[9px] font-black uppercase text-white bg-primary/80 rounded px-1.5 py-0.5">
                  {t.featured}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm font-bold leading-tight">
              {isRtl ? p.nameAr : p.nameFr || p.nameAr}
            </p>
            <p className="text-sm font-extrabold text-primary">
              {p.price.toLocaleString('fr-DZ')} {isRtl ? 'د.ج' : 'DZD'}
            </p>
            {p.stock <= 0 && (
              <p className="text-[10px] font-bold text-destructive">{t.outOfStock}</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
