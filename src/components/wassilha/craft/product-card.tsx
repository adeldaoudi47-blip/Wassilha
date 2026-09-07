'use client';

import { useState } from 'react';
import { Hammer, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '../use-t';
import type { CraftProductPublic } from '@/lib/types';

// HIRFA product card (P3). The favourite heart is a local visual toggle
// for now - persisted favourites land in a later HIRFA phase.
export function ProductCard({
  product,
  onOpen,
}: {
  product: CraftProductPublic;
  onOpen: (p: CraftProductPublic) => void;
}) {
  const { t, isAr } = useT();
  const [fav, setFav] = useState(false);
  const name = isAr ? product.nameAr : product.nameFr || product.nameAr;
  const madeToOrder = product.stock <= 0;
  const img = product.images && product.images.length > 0 ? product.images[0] : null;

  return (
    <button
      onClick={() => onOpen(product)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-start shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {img ? (
          <img
            src={img}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Hammer size={36} className="text-muted-foreground/30" />
          </div>
        )}
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            setFav((v) => !v);
          }}
          className={cn(
            'absolute top-2 end-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 backdrop-blur transition-colors',
            fav ? "text-rose-500" : "text-muted-foreground"
          )}
        >
          <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
        </span>
        <span
          className={cn(
            'absolute bottom-2 start-2 rounded-full px-2 py-0.5 text-[10px] font-bold',
            madeToOrder
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
          )}
        >
          {madeToOrder ? t.madeToOrder : t.readyToOrder}
        </span>
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="truncate text-sm font-bold text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t.craftedBy} {product.artisan.displayName}
        </p>
        <p className="text-sm font-extrabold text-primary">
          {product.price} {t.currencyDzd}
        </p>
      </div>
    </button>
  );
}
