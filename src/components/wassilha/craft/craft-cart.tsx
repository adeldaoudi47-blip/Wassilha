'use client';

import { Minus, Plus, ShoppingBag, Trash2, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { useCraftCart } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type { AuthUser } from '@/lib/types';

// HIRFA (P6): customer cart & checkout. Displays cart items from the
// client-side Zustand store, lets the customer adjust quantity or remove
// items, then calls POST /api/craft/orders to place the order. The server
// recomputes all prices and verifies stock (OWASP V7).
//
// GUEST CHECKOUT GUARD: placing an order requires a session (the API
// resolves the customer from the session cookie, not from the cart
// payload). The component therefore checks /api/auth/me on mount; while
// the check is in flight we keep the checkout button disabled, and if no
// session exists we render the "please log in" CTA instead of the pay
// button. The login link carries ?redirect=/craft/cart so the buyer lands
// back here the moment their OTP succeeds.
export function CraftCart() {
  const { t, isAr } = useT();
  const items = useCraftCart((s) => s.items);
  const removeItem = useCraftCart((s) => s.removeItem);
  const clear = useCraftCart((s) => s.clear);
  const [submitting, setSubmitting] = useState(false);
  // Session state: 'checking' while /api/auth/me is in flight, then the
  // resolved user or null (guest). Kept local: the cart is also embedded in
  // the logged-in SPA tab AND on the public /craft/cart page, so we cannot
  // assume the parent already booted the auth state.
  const [me, setMe] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (!cancelled) setMe(user);
      })
      .catch(() => {
        // Network/API failure: fail closed (treat as guest) so checkout is
        // never enabled without a verified session.
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const adjustQty = (productId: string, delta: number) => {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      removeItem(productId);
    } else {
      // Update qty in store by removing and re-adding with new qty
      removeItem(productId);
      // Re-add with new quantity via the store's addItem
      const store = useCraftCart.getState();
      store.addItem(
        { productId: item.productId, nameAr: item.nameAr, price: item.price, image: item.image },
        newQty
      );
    }
  };

  const totalDisplay = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  const handleCheckout = async () => {
    if (items.length === 0) return;
    // Defense in depth: the UI hides the button for guests, but the order
    // API resolves the customer from the session — never trust the button.
    if (!me) return;
    setSubmitting(true);
    try {
      const res = await api.createCraftOrder({
        items: items.map((i) => ({ productId: i.productId, quantity: i.qty })),
        deliveryOption: 'pickup',
      });
      clear();
      // Phase 2B: the server splits a multi-store cart into one order per store.
      const n = res.orders?.length ?? 1;
      toast.success(t.orderPlaced, {
        description: n > 1
          ? (isAr ? `تم إنشاء ${n} طلبات لكل متجر على حدة` : `${n} commandes créées, une par boutique`)
          : t.orderPlacedMsg,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'insufficientStock' || msg.includes('insufficientStock')) {
        toast.error(t.insufficientStock);
      } else if (msg === 'productNotFound') {
        toast.error(isAr ? 'المنتج غير موجود' : 'Produit introuvable');
      } else {
        toast.error(isAr ? 'فشل تقديم الطلب' : 'Échec de la commande');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShoppingBag size={48} className="text-muted-foreground/30" />
        <p className="mt-4 text-sm text-muted-foreground">{t.emptyCart}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
        <ShoppingBag size={18} className="text-primary" />
        {t.cart}
      </h2>

      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.productId} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
            {item.image ? (
              <img src={item.image} alt={item.nameAr} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted">
                <ShoppingBag size={22} className="text-muted-foreground/40" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-foreground">{item.nameAr}</p>
              <p className="text-xs font-extrabold text-primary">
                {item.price} {t.currencyDzd}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => adjustQty(item.productId, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                >
                  {item.qty <= 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                </button>
                <span className="min-w-[2rem] text-center text-sm font-bold">{item.qty}</span>
                <button
                  onClick={() => adjustQty(item.productId, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div className="text-end">
              <p className="text-sm font-extrabold text-foreground">
                {item.price * item.qty} {t.currencyDzd}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-4">
        <span className="text-sm font-bold text-foreground">{t.total}</span>
        <span className="text-lg font-black text-primary">
          {totalDisplay} {t.currencyDzd}
        </span>
      </div>

      {/* Checkout */}
      {me === null ? (
        // GUEST: no session. Orders are keyed to a session customer, so we
        // block checkout and funnel the buyer through the (now signup-free)
        // phone-OTP login, sending them back to the cart afterwards.
        <div className="space-y-3">
          <div
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {isAr
              ? 'يرجى تسجيل الدخول لإتمام الطلب'
              : 'Veuillez vous connecter pour finaliser la commande'}
          </div>
          <a href="/?redirect=/craft/cart" className="block">
            <Button
              className="h-12 w-full rounded-2xl bg-primary text-sm font-extrabold text-white"
              size="lg"
            >
              <LogIn size={16} className="me-2" />
              {isAr ? 'تسجيل الدخول / Se connecter' : 'Se connecter'}
            </Button>
          </a>
        </div>
      ) : (
        <Button
          onClick={handleCheckout}
          // Disabled while the session check is in flight (me === undefined)
          // or while the order is submitting — checkout must never be
          // reachable without a verified session.
          disabled={submitting || me === undefined}
          className="h-12 w-full rounded-2xl bg-emerald-600 text-sm font-extrabold text-white hover:bg-emerald-700"
        >
          {submitting && <Loader2 size={16} className="me-1 animate-spin" />}
          {me === undefined
            ? isAr
              ? 'جارٍ التحقق…'
              : 'Vérification…'
            : t.checkout}
        </Button>
      )}
    </div>
  );
}
