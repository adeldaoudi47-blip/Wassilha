'use client';

// HIRFAA Phase 1 — public cart link (header button).
// Reuses the existing Zustand craft cart store (useCraftCart) so the badge
// stays in sync with whatever the customer adds from a public product page.
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCraftCart } from '@/lib/store';
import { getT } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';

function CartButton({ count }: { count: number }) {
  return (
    <button
      type="button"
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
      aria-label="cart"
    >
      <ShoppingBag size={18} />
      {count > 0 && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

export function CartLink() {
  const lang = useAppStore((s) => s.lang);
  const t = getT(lang);
  const count = useCraftCart((s) => s.items.length);
  return (
    <Link href="/craft/cart" aria-label={t.cart}>
      <CartButton count={count} />
    </Link>
  );
}

