'use client';

import { Minus, Plus, ShoppingBag, Trash2, Loader2, LogIn, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { useCraftCart } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type { AuthUser, CouponPreview } from '@/lib/types';

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
  // HIRFA Phase 3: the coupon the buyer typed (kept local until validated, so
  // a wrong code never silently sticks to the persisted store).
  const couponCode = useCraftCart((s) => s.couponCode);
  const setCouponCode = useCraftCart((s) => s.setCouponCode);
  const [codeInput, setCodeInput] = useState(couponCode ?? '');
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [validating, setValidating] = useState(false);
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

  const adjustQty = (productId: string, variantId: string | null, delta: number) => {
    const item = items.find((i) => i.productId === productId && i.variantId === variantId);
    if (!item) return;
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      removeItem(productId, variantId);
    } else {
      // Update qty in store by removing and re-adding with new qty
      removeItem(productId, variantId);
      // Re-add with new quantity via the store's addItem (same variant key)
      const store = useCraftCart.getState();
      store.addItem(
        { productId: item.productId, variantId: item.variantId, nameAr: item.nameAr, price: item.price, image: item.image },
        newQty
      );
    }
  };

  // HIRFA Phase 3: cart subtotal. `item.price` is the PREVIEW unit price the
  // product page computed (tier + variant aware); the server recomputes the
  // authoritative numbers at checkout, so this is display-only.
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = preview?.valid ? preview.discount : 0;
  const totalDisplay = Math.max(0, subtotal - discount);

  // HIRFA Phase 3: preview the coupon without redeeming it (the API only
  // BURNS a code inside the order transaction). Cleared whenever the cart
  // empties so a stale preview can never be shown next to a zero subtotal.
  useEffect(() => {
    if (!couponCode || subtotal <= 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setValidating(true);
    api
      .validateCoupon(couponCode, subtotal)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [couponCode, subtotal]);

  const applyCoupon = () => {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 2) return;
    setCouponCode(code);
  };

  const removeCoupon = () => {
    setCouponCode(null);
    setCodeInput('');
    setPreview(null);
  };

  // Map a coupon sentinel from either the preview or the order error to a
  // localized message (the API returns the same codes in both places).
  const couponErrorText = (code?: string) => {
    switch (code) {
      case 'couponNotFound':
        return t.couponNotFound;
      case 'couponExpired':
        return t.couponExpired;
      case 'couponExhausted':
        return t.couponExhausted;
      default:
        return t.invalidCoupon;
    }
  };

  const handleCheckout = async () => {
    if (items.length === 0) return;
    // Defense in depth: the UI hides the button for guests, but the order
    // API resolves the customer from the session — never trust the button.
    if (!me) return;
    setSubmitting(true);
    try {
      const res = await api.createCraftOrder({
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.qty,
        })),
        deliveryOption: 'pickup',
        couponCode: couponCode || null,
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
      } else if (msg.includes('couponNotFound')) {
        // HIRFA Phase 3: the code was fine at preview time but is gone now
        // (deleted by the artisan meanwhile). Drop it so the buyer isn't
        // stuck with an un-checkoutable code.
        toast.error(t.couponNotFound);
        removeCoupon();
      } else if (msg.includes('couponExpired') || msg.includes('couponExhausted')) {
        toast.error(couponErrorText(msg.includes('couponExpired') ? 'couponExpired' : 'couponExhausted'));
        removeCoupon();
      } else if (msg.includes('variantOutOfStock') || msg.includes('variantNotFound')) {
        toast.error(isAr ? 'الخيار المحدد غير متوفر الآن' : 'La variante choisie est en rupture');
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
              {/* HIRFA Phase 3: the variant the buyer picked, if any. */}
              {item.variantId ? (
                <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {t.variant}: {item.variantId.slice(-6)}
                </span>
              ) : null}
              <p className="text-xs font-extrabold text-primary">
                {item.price} {t.currencyDzd}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => adjustQty(item.productId, item.variantId, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                >
                  {item.qty <= 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                </button>
                <span className="min-w-[2rem] text-center text-sm font-bold">{item.qty}</span>
                <button
                  onClick={() => adjustQty(item.productId, item.variantId, 1)}
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

      {/* HIRFA Phase 3: coupon input. Nothing is redeemed here — the cart
          calls the validate endpoint (preview only) and the code is burned
          inside the order transaction server-side, so a buyer can never
          spend a coupon without actually buying. */}
      <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <Ticket size={14} className="text-primary" />
          <p className="text-xs font-black text-foreground">{t.couponCode}</p>
        </div>
        <div className="flex gap-2">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder={t.couponPlaceholder}
            dir="ltr"
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyCoupon();
            }}
          />
          {couponCode ? (
            <button
              onClick={removeCoupon}
              className="shrink-0 rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              {t.removeCoupon}
            </button>
          ) : (
            <button
              onClick={applyCoupon}
              disabled={validating || codeInput.trim().length < 2}
              className="shrink-0 rounded-xl bg-primary px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {validating ? <Loader2 size={13} className="animate-spin" /> : t.applyCoupon}
            </button>
          )}
        </div>
        {/* Preview result: the exact discount the server WILL apply, or the
            reason the code is refused. */}
        {couponCode && preview ? (
          preview.valid ? (
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              {t.couponApplied} • {t.discount}: -{preview.discount} {t.currencyDzd}
            </p>
          ) : (
            <p className="text-[11px] font-bold text-rose-500">
              {couponErrorText(preview.error)}
            </p>
          )
        ) : (
          <p className="text-[10px] text-muted-foreground">{t.couponScopeHint}</p>
        )}
      </div>

      {/* Total */}
      <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t.total}</span>
          <span>{subtotal} {t.currencyDzd}</span>
        </div>
        {discount > 0 && (
          <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span>{t.discount}</span>
            <span>-{discount} {t.currencyDzd}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-sm font-black text-foreground">{t.totalAfterDiscount}</span>
          <span className="text-lg font-black text-primary">
            {totalDisplay} {t.currencyDzd}
          </span>
        </div>
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
