'use client';

// HIRFA Phase 1 — public "Add to cart" for the SEO product page.
// REUSES the existing useCraftCart Zustand store (same store the in-app
// HirfaHome/CraftCart flow uses), so public visitors and logged-in customers
// share one cart. No auth change, no cart redesign (Phase 1 constraint).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Check } from 'lucide-react';
import { useCraftCart } from '@/lib/store';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import type { Lang } from '@/lib/types';

export interface PublicAddToCartProduct {
  productId: string;
  nameAr: string;
  price: number;
  image?: string;
  stock: number;
  isMadeToOrder?: boolean;
}

export function PublicAddToCart({
  product,
  lang = 'ar',
  storeSlug,
  productSlug,
}: {
  product: PublicAddToCartProduct;
  lang?: Lang;
  storeSlug: string;
  productSlug: string;
}) {
  const t = getMarketplaceT(lang);
  const router = useRouter();
  const addItem = useCraftCart((s) => s.addItem);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  // Made-to-order products are crafted on demand: ordering is always allowed
  // and stock is never a blocker for them.
  const outOfStock = !product.isMadeToOrder && product.stock <= 0;

  const handleAdd = () => {
    if (outOfStock) return;
    addItem(
      {
        productId: product.productId,
        // HIRFA Phase 3: the public SEO page has no variant picker, so a
        // variant-less line is added (variantId === null). The checkout API
        // accepts null and prices it off the plain product price.
        variantId: null,
        nameAr: product.nameAr,
        price: product.price,
        image: product.image ?? null,
      },
      qty
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const handleGoToCart = () => {
    router.push('/craft/cart');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          className="h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-foreground"
          aria-label="-"
        >
          −
        </button>
        <span className="min-w-[2rem] text-center text-sm font-black">{qty}</span>
        <button
          onClick={() => setQty((q) => Math.min(product.isMadeToOrder ? 99 : product.stock, q + 1))}
          disabled={outOfStock}
          className="h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
          aria-label="+"
        >
          +
        </button>
      </div>
      <button
        onClick={handleAdd}
        disabled={outOfStock}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground shadow transition hover:bg-brand-dark disabled:opacity-50"
      >
        {added ? <Check size={16} /> : <Plus size={16} />}
        {outOfStock ? t.outOfStock : added ? t.copied : t.addToCart}
      </button>
      {product.isMadeToOrder && (
        <p className="text-center text-[11px] font-bold text-amber-600 dark:text-amber-400">
          {t.madeToOrderHint}
        </p>
      )}
      <button
        onClick={handleGoToCart}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 text-sm font-bold text-primary hover:bg-primary/5"
      >
        {t.viewCart}
      </button>
    </div>
  );
}
