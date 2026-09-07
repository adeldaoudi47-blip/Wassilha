'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MapPin, ShoppingBag, Star } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../use-t';
import { useCraftCart } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { CraftProductPublic } from '@/lib/types';

// HIRFA product detail (P3): gallery, artisan shop card, add-to-cart.
// The cart is client-side only (see store.ts) - pricing is re-verified
// server-side at checkout time in a later phase.
export function ProductDetail({
  product,
  onBack,
}: {
  product: CraftProductPublic;
  onBack: () => void;
}) {
  const { t, isAr } = useT();
  const addItem = useCraftCart((s) => s.addItem);
  const [imgIdx, setImgIdx] = useState(0);
  const [added, setAdded] = useState(false);
  const BackArrow = isAr ? ArrowRight : ArrowLeft;
  const name = isAr ? product.nameAr : product.nameFr || product.nameAr;
  const description = isAr
    ? product.descriptionAr
    : product.descriptionFr || product.descriptionAr;
  const madeToOrder = product.stock <= 0;
  const images = product.images && product.images.length > 0 ? product.images : [];

  const handleAdd = () => {
    addItem({
      productId: product.id,
      nameAr: name,
      price: product.price,
      image: images[0] ?? null,
    });
    setAdded(true);
    toast.success(t.addedToCart);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <BackArrow size={16} />
        {t.back}
      </button>

      {/* Gallery */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted">
        {images.length > 0 ? (
          <img src={images[imgIdx]} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag size={44} className="text-muted-foreground/30" />
          </div>
        )}
        <span
          className={cn(
            'absolute top-3 start-3 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm',
            madeToOrder
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
          )}
        >
          {madeToOrder ? t.madeToOrder : t.readyToOrder}
        </span>
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src + i}
              onClick={() => setImgIdx(i)}
              className={cn(
                "h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 transition-colors",
                i === imgIdx ? "border-primary" : "border-transparent opacity-70"
              )}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Title + price */}
      <div>
        <h1 className="text-lg font-extrabold text-foreground">{name}</h1>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xl font-black text-primary">
            {product.price} {t.currencyDzd}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold",
              madeToOrder
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
            )}
          >
            {madeToOrder ? t.madeToOrder : t.readyToOrder}
          </span>
        </div>
      </div>

      {/* Artisan shop card - public projection only (see lib/dto.ts) */}
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        {product.artisan.avatarUrl ? (
          <img src={product.artisan.avatarUrl} alt={product.artisan.displayName} className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">
            {product.artisan.displayName.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            {t.craftedBy} {product.artisan.displayName}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <Star size={12} className="text-amber-400" fill="currentColor" />
              {product.artisan.rating.toFixed(1)}
            </span>
            {product.artisan.area && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin size={12} />
                {isAr ? product.artisan.area.nameAr : product.artisan.area.nameFr || product.artisan.area.nameAr}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {/* Add to cart */}
      <button
        onClick={handleAdd}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg transition-transform active:scale-[0.98]",
          added ? "bg-emerald-600" : "bg-primary"
        )}
      >
        {added ? <Check size={18} /> : <ShoppingBag size={18} />}
        {added ? t.addedToCart : t.addToCart}
      </button>
    </div>
  );
}
