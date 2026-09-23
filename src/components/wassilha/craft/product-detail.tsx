'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, MapPin, MessageCircle, Play, ShoppingBag,
  Star, Tag, Loader2, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../use-t';
import { useCraftCart } from '@/lib/store';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { pickTier, unitPriceFor } from '@/lib/craft-pricing';
import type {
  CraftProductPublic, ProductQAPublic, ProductVariantPublic,
} from '@/lib/types';

// HIRFA product detail (P3 + Phase 3): gallery, product video, variant picker
// with a live (client-previewed) unit price, the graduated-price tier table,
// Q&A, and add-to-cart. The cart is client-side only (see store.ts) — every
// number shown here is a PREVIEW; the server recomputes pricing at checkout
// from the DB, so a stale/edited cache can never change what is charged.
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
  // HIRFA Phase 3: quantity drives the graduated tier preview.
  const [qty, setQty] = useState(1);
  // HIRFA Phase 3: the chosen variant (null until the buyer picks one).
  const [variantId, setVariantId] = useState<string | null>(null);
  // HIRFA Phase 3: Q&A thread for this product (public read).
  const [qa, setQa] = useState<ProductQAPublic[]>([]);
  const [qaLoading, setQaLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const BackArrow = isAr ? ArrowRight : ArrowLeft;
  const name = isAr ? product.nameAr : product.nameFr || product.nameAr;
  const description = isAr
    ? product.descriptionAr
    : product.descriptionFr || product.descriptionAr;
  // "حسب الطلب": explicitly crafted on demand — stock is irrelevant for it.
  // A stock-tracked product at 0 is OUT OF STOCK, not made-to-order: the old
  // `|| product.stock <= 0` gave every sold-out item a misleading amber
  // "made to order" badge and let the buyer add it → 409 at checkout.
  const madeToOrder = product.isMadeToOrder;
  const outOfStock = !product.isMadeToOrder && product.stock <= 0;
  const images = product.images && product.images.length > 0 ? product.images : [];

  // HIRFA Phase 3: variants / tiers straight off the product DTO.
  const variants = product.variants ?? [];
  const tiers = product.tiers ?? [];
  const selectedVariant: ProductVariantPublic | undefined = variants.find((v) => v.id === variantId);
  const needsVariant = variants.length > 0;

  // HIRFA Phase 3: live unit-price preview = tier price (if the qty qualifies)
  // + the variant adjustment. Mirrors the server's unitPriceFor() exactly, so
  // what the buyer sees is what the checkout will charge (the server remains
  // the source of truth — this value is never sent).
  const unitPreview = unitPriceFor(product.price, selectedVariant?.priceAdjustment ?? 0, qty, tiers);
  const activeTier = pickTier(tiers, qty);
  const variantOutOfStock = !!selectedVariant && !madeToOrder && (selectedVariant.stock ?? 0) <= 0;
  // The buy button is blocked until a variant is chosen when the product has
  // any (the server 409s an unknown/absent variant anyway).
  const blocked = outOfStock || variantOutOfStock || (needsVariant && !selectedVariant);

  // HIRFA Phase 3: Q&A is public — anyone browsing the product can read it.
  useEffect(() => {
    setQaLoading(true);
    api
      .listCraftProductQuestions(product.id)
      .then(setQa)
      .catch(() => setQa([]))
      .finally(() => setQaLoading(false));
  }, [product.id]);

  const handleAdd = () => {
    // Guard: a stock-tracked product at 0 must never enter the cart — the
    // server rejects it with 409 insufficientStock at checkout. Made-to-order
    // items pass through (stock is meaningless for them).
    if (outOfStock || variantOutOfStock) return;
    // A product with variants cannot be bought without choosing one: the
    // checkout API validates the variant id against THIS product.
    if (needsVariant && !selectedVariant) {
      toast.error(t.selectVariantFirst);
      return;
    }
    addItem(
      {
        productId: product.id,
        variantId: selectedVariant?.id ?? null,
        nameAr: name,
        // Preview price (UX only) — the server recomputes it at checkout.
        price: unitPreview,
        image: images[0] ?? null,
      },
      qty,
    );
    setAdded(true);
    toast.success(t.addedToCart);
    setTimeout(() => setAdded(false), 1500);
  };

  // HIRFA Phase 3: post a buyer question. The API resolves the asker from the
  // session cookie (never a body field); a 401 falls back to a toast here.
  const handleAsk = async () => {
    const q = newQuestion.trim();
    if (q.length < 3) return;
    setAsking(true);
    try {
      const created = await api.askCraftProductQuestion(product.id, q);
      setQa((prev) => [created, ...prev]);
      setNewQuestion('');
      toast.success(t.questionSent);
    } catch {
      toast.error(t.fetchError);
    } finally {
      setAsking(false);
    }
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
              : outOfStock
                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
          )}
        >
          {madeToOrder ? t.madeToOrder : outOfStock ? t.outOfStock : t.readyToOrder}
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

      {/* HIRFA Phase 3: product video (YouTube embed or direct Blob/video
          URL). Rendered after the gallery so a slow video never blocks the
          images, and never auto-plays (user-gesture only). */}
      {product.videoUrl ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-black">
          <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white/80">
            <Play size={12} />
            {t.productVideo}
          </div>
          {/youtube\.com|youtu\.be/i.test(product.videoUrl) ? (
            <iframe
              src={product.videoUrl.replace('watch?v=', 'embed/')}
              title={t.productVideo}
              className="aspect-video w-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              src={product.videoUrl}
              controls
              playsInline
              className="aspect-video w-full"
              poster={images[0]}
            />
          )}
        </div>
      ) : null}

      {/* Title + price */}
      <div>
        <h1 className="text-lg font-extrabold text-foreground">{name}</h1>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xl font-black text-primary">
            {/* HIRFA Phase 3: with graduated pricing, show "ابتداءً من" (the
                lowest reachable price) instead of a single fixed price. */}
            {product.basePrice ? (
              <>
                <span className="text-[11px] font-bold text-muted-foreground">
                  {t.startingFrom}{' '}
                </span>
                {product.basePrice}
              </>
            ) : (
              product.price
            )}{' '}
            {t.currencyDzd}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold",
              madeToOrder
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                : outOfStock
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
            )}
          >
            {madeToOrder ? t.madeToOrder : outOfStock ? t.outOfStock : t.readyToOrder}
          </span>
        </div>
      </div>

      {/* HIRFA Phase 3: variant picker (Alibaba-style SKUs). The button label
          shows the price adjustment (+/-) so the buyer sees the delta before
          tapping; a sold-out variant is disabled, not hidden. */}
      {needsVariant && (
        <div className="space-y-2">
          <label className="text-xs font-bold text-foreground">
            {t.chooseVariant}
            <span className="text-primary"> *</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const dead = !madeToOrder && (v.stock ?? 0) <= 0;
              const selected = variantId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={dead}
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    'rounded-xl border-2 px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    selected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-foreground hover:border-primary/40',
                  )}
                >
                  {isAr ? v.nameAr : v.nameFr || v.nameAr}
                  {v.priceAdjustment ? (
                    <span className="ms-1 text-[10px] text-muted-foreground">
                      ({v.priceAdjustment > 0 ? '+' : ''}
                      {v.priceAdjustment})
                    </span>
                  ) : null}
                  {dead ? (
                    <span className="ms-1 text-[10px] text-rose-500">•</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* HIRFA Phase 3: graduated (wholesale) price ladder. The rung the
          current quantity unlocks is highlighted, so the buyer sees exactly
          how much more they need to add to reach the next discount. */}
      {tiers.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
            <Tag size={13} className="text-primary" />
            <p className="text-xs font-black text-foreground">{t.wholesalePricing}</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-3 py-1.5 text-start font-bold">{t.tierMinQuantity}</th>
                <th className="px-3 py-1.5 text-end font-bold">{t.tierUnitPrice}</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                // pickTier returns the rung with the highest minQuantity that
                // qty still satisfies; identify it by that minQuantity.
                const reached = !!activeTier && activeTier.minQuantity === tier.minQuantity;
                return (
                  <tr
                    key={tier.id}
                    className={cn(
                      'border-t border-border',
                      reached && 'bg-emerald-50 dark:bg-emerald-950/30',
                    )}
                  >
                    <td className="px-3 py-1.5 font-bold text-foreground">
                      ≥ {tier.minQuantity}
                      {reached ? <span className="ms-1.5 text-[10px] text-emerald-600">✓</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-end font-black text-primary">
                      {tier.unitPrice} {t.currencyDzd}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-muted-foreground">{t.tierHint}</p>
        </div>
      )}

      {/* HIRFA Phase 3: quantity + live unit-price preview. The number shown
          is recomputed with the same helper the server uses at checkout. */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">{t.qty}</span>
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            aria-label="-"
          >
            −
          </button>
          <span className="min-w-[2rem] text-center text-sm font-black">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            aria-label="+"
          >
            +
          </button>
        </div>
        <div className="text-end">
          <p className="text-[10px] text-muted-foreground">
            {activeTier ? t.tierReached : t.perUnit}
            {selectedVariant ? ` • ${isAr ? selectedVariant.nameAr : selectedVariant.nameFr || selectedVariant.nameAr}` : ''}
          </p>
          <p className="text-sm font-black text-primary">
            {unitPreview} {t.currencyDzd}
          </p>
        </div>
      </div>

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

      {/* HIRFA Phase 3: Questions & Answers. Public read; asking resolves the
          asker from the session cookie server-side (never from the body), so
          a failure here means "please log in" and is surfaced as a toast. */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <MessageCircle size={14} className="text-primary" />
          <p className="text-sm font-black text-foreground">{t.questionsAndAnswers}</p>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            {qa.length}
          </span>
        </div>

        {/* Ask a question */}
        <div className="flex gap-2">
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder={t.questionPlaceholder}
            maxLength={500}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={handleAsk}
            disabled={asking || newQuestion.trim().length < 3}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-bold text-white transition-opacity disabled:opacity-40"
          >
            {asking ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {t.askQuestion}
          </button>
        </div>

        {/* QA list: answered first, then newest pending. */}
        {qaLoading ? (
          <p className="py-3 text-center text-xs text-muted-foreground">…</p>
        ) : qa.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{t.noQuestionsYet}</p>
        ) : (
          <div className="space-y-2.5">
            {[...qa]
              .sort((a, b) => {
                const ra = a.answer ? 1 : 0;
                const rb = b.answer ? 1 : 0;
                return rb - ra || b.createdAt.localeCompare(a.createdAt);
              })
              .map((q) => (
                <div key={q.id} className="rounded-xl bg-muted/40 p-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black',
                        q.answer
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
                      )}
                    >
                      {q.answer ? t.answeredBadge : t.pendingBadge}
                    </span>
                    <p className="text-xs font-bold text-foreground">{q.question}</p>
                  </div>
                  {q.answer ? (
                    <p className="mt-1.5 ps-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-bold text-foreground">{t.sellerReply}: </span>
                      {q.answer}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {q.user?.name ?? '—'} •{' '}
                    {new Date(q.createdAt).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ')}
                  </p>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Add to cart */}
      <button
        onClick={handleAdd}
        disabled={blocked}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          added ? "bg-emerald-600" : "bg-primary"
        )}
      >
        {added ? <Check size={18} /> : <ShoppingBag size={18} />}
        {outOfStock
          ? t.outOfStock
          : variantOutOfStock
            ? t.variantOutOfStock
            : needsVariant && !selectedVariant
              ? t.chooseVariant
              : added
                ? t.addedToCart
                : t.addToCart}
      </button>
    </div>
  );
}
