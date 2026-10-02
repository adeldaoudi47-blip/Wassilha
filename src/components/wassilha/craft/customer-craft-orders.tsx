'use client';

import { useEffect, useState } from 'react';
import { Package, Star, ShoppingBag, Truck, ThumbsUp, MessageSquareReply } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '../skeleton';
import { CraftRatingDialog } from './craft-rating-dialog';
import { cn } from '@/lib/utils';
import type { CraftOrderPublic } from '@/lib/types';

export function CustomerCraftOrders() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<CraftOrderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingOrderId, setRatingOrderId] = useState<string | null>(null);
  const [ratingOrderArtisan, setRatingOrderArtisan] = useState<string | null>(null);
  // HIRFA Phase 3: this session's "helpful" votes, for optimistic counts.
  const [myVotes, setMyVotes] = useState<Record<string, boolean>>({});

  const fetchOrders = () => {
    api.getCraftOrders().then((res) => setOrders(res.orders)).catch(() => toast.error(t.fetchError)).finally(() => setLoading(false));
  };

  // Retry path (after a rating submit): resets the spinner synchronously.
  const load = () => {
    setLoading(true);
    fetchOrders();
  };

  useEffect(() => {
    // Initial fetch: state updates happen inside promise callbacks only
    // (no synchronous setState in the effect body).
    fetchOrders();
  }, []);

  const statusColor = (s: string) => {
    const colors: Record<string, string> = { pending: 'bg-amber-100 text-amber-800', confirmed: 'bg-sky-100 text-sky-800', ready: 'bg-emerald-100 text-emerald-800', delivered: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800' };
    return colors[s] || 'bg-muted text-muted-foreground';
  };

  const statusLabel = (s: string) => {
    const labels: Record<string, string> = { pending: isAr ? 'قيد الانتظار' : 'En attente', confirmed: isAr ? 'مؤكد' : 'Confirmé', ready: isAr ? 'جاهز' : 'Prêt', delivered: isAr ? 'تم التسليم' : 'Livré', cancelled: isAr ? 'ملغى' : 'Annulé' };
    return labels[s] || s;
  };

  // -------------------------------------------------------------------------
  // PHASE 7B — delivery tracking.
  //
  // Derived from the nested `delivery` block the API now returns. Labels reuse
  // the EXISTING transport keys (orderStatusSearching / orderStatusAccepted /
  // orderStatusPicked / delivered) so a marketplace card and a transport card
  // can never disagree about what a status means. No new subscription is
  // added: the card refreshes on this page's existing fetch cycle.
  // -------------------------------------------------------------------------
  const DELIVERY_STEP_ORDER = ['searching', 'accepted', 'picked', 'delivered'] as const;

  const deliveryStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      searching: t.orderStatusSearching,
      scheduled: t.orderStatusSearching,
      accepted: t.orderStatusAccepted,
      picked: t.orderStatusPicked,
      delivered: t.delivered,
      cancelled: isAr ? 'ملغى' : 'Annulé',
    };
    return labels[s] ?? s;
  };

  const deliveryStepReached = (
    delivery: CraftOrderPublic['delivery'],
    step: (typeof DELIVERY_STEP_ORDER)[number],
  ) => {
    // Nullable by contract: a pickup order has no delivery. Guarding here keeps
    // the call site free of non-null assertions, which narrowing cannot prove
    // inside the `.map()` closure anyway.
    if (!delivery || delivery.status === 'cancelled') return false;
    const current = DELIVERY_STEP_ORDER.indexOf(
      delivery.status as (typeof DELIVERY_STEP_ORDER)[number],
    );
    const target = DELIVERY_STEP_ORDER.indexOf(step);
    if (current === -1 || target === -1) return false;
    return target <= current;
  };

  // HIRFA Phase 3: cast a "helpful" vote on one of the customer's own past
  // reviews (idempotent toggle). The API resolves the voter from the session,
  // so a customer can only vote once per review.
  const handleVote = async (reviewId: string) => {
    try {
      const res = await api.likeCraftReview(reviewId);
      setMyVotes((prev) => ({ ...prev, [reviewId]: res.liked }));
      setOrders((prev) =>
        prev.map((o) =>
          o.review?.id === reviewId && o.review
            ? {
                ...o,
                review: {
                  ...o.review,
                  likeCount: Math.max(0, o.review.likeCount + (res.liked ? 1 : -1)),
                },
              }
            : o,
        ),
      );
    } catch {
      // Best-effort: keep the list usable even if the vote fails.
    }
  };

  if (loading) return (<div className="space-y-3"><ListSkeleton count={3} /></div>);
  if (orders.length === 0) {
    return (<div className="flex flex-col items-center justify-center py-16 text-center"><Package size={48} className="text-muted-foreground/30" /><p className="mt-4 text-sm text-muted-foreground">{isAr ? 'لا توجد طلبات حِرفة بعد' : 'Aucune commande artisanat'}</p></div>);
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground"><ShoppingBag size={18} className="text-primary" />{isAr ? 'طلباتي من حِرفة' : 'Mes commandes artisanat'}</h2>
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between"><div><span className="font-mono text-xs font-bold text-primary">{order.code}</span></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor(order.status)}`}>{statusLabel(order.status)}</span></div>
            <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs font-bold text-foreground">{t.craftedBy} {order.artisan.displayName}</p></div>
            {/* PHASE 7B — live delivery tracking. The static "delivered by
                Wassilha" badge is replaced by the real state of the linked
                transport Order. A pickup order has `delivery === null`, so
                this block simply does not render and that flow is unchanged. */}
            {order.deliveryOption === 'wassilha_delivery' && order.delivery && (
              <div className="space-y-2 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                    <Truck size={14} />
                    {t.deliveryTracking}
                  </span>
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    {deliveryStatusLabel(order.delivery.status)}
                  </span>
                </div>

                {/* Driver name only — the API never sends a phone number here. */}
                <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200">
                  {t.deliveryDriver}:{' '}
                  {order.delivery.driver?.name
                    ? order.delivery.driver.name
                    : t.deliveryDriverSearching}
                </p>

                {/* Four-step timeline derived from the status; no new events. */}
                <ol className="space-y-1 pt-1">
                  {(
                    [
                      ['searching', t.deliveryStepCreated],
                      ['accepted', t.deliveryStepAccepted],
                      ['picked', t.deliveryStepPicked],
                      ['delivered', t.deliveryStepDelivered],
                    ] as const
                  ).map(([step, label]) => {
                    const done = deliveryStepReached(order.delivery, step);
                    return (
                      <li key={step} className="flex items-center gap-2 text-[11px]">
                        <span
                          className={cn(
                            'inline-block size-3.5 shrink-0 rounded-full border-2',
                            done
                              ? 'border-blue-600 bg-blue-600'
                              : 'border-blue-300 dark:border-blue-800',
                          )}
                        />
                        <span
                          className={cn(
                            'font-medium',
                            done
                              ? 'text-blue-800 dark:text-blue-200'
                              : 'text-blue-400 dark:text-blue-800',
                          )}
                        >
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {/* DELIVERY money only. The product subtotal stays on the order
                    total above; the two are never merged. */}
                <p className="border-t border-blue-200 pt-2 text-[11px] font-bold text-blue-800 dark:border-blue-900 dark:text-blue-200">
                  {t.deliveryFeeLabel}:{' '}
                  {order.delivery.finalPrice ?? order.delivery.price} {t.currencyDzd}
                </p>
              </div>
            )}
            {/* HIRFA Phase 3: item lines with the chosen variant. The server
                snapshots the variant on the order line (onDelete: SetNull),
                so a variant removed later still shows what was bought. */}
            <div className="space-y-1.5">
              {order.items.map((item) => {
                const name = isAr ? item.product.nameAr : item.product.nameFr || item.product.nameAr;
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-foreground">
                      {item.product.images?.[0] ? (
                        <img src={item.product.images[0]} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <ShoppingBag size={14} className="text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        {name} <span className="text-muted-foreground">×{item.quantity}</span>
                        {item.variant ? (
                          <span className="ms-1 inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary">
                            {isAr ? item.variant.nameAr : item.variant.nameFr || item.variant.nameAr}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="font-bold text-foreground">{item.unitPrice * item.quantity} {t.currencyDzd}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-xs font-bold text-foreground">{t.total}</span><span className="text-sm font-black text-primary">{order.totalPrice} {t.currencyDzd}</span></div>
            {order.status === 'delivered' && !order.review && (<Button onClick={() => { setRatingOrderId(order.id); setRatingOrderArtisan(order.artisan.displayName); }} variant="outline" className="w-full rounded-xl border-amber-200 text-xs font-bold text-amber-600"><Star size={14} className="me-1" />{t.rateCraftOrder}</Button>)}
            {order.status === 'delivered' && order.review ? (
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={12}
                        className={cn(
                          i < order.review!.score ? 'text-amber-400' : 'text-muted-foreground/30',
                        )}
                        fill={i < order.review!.score ? 'currentColor' : 'none'}
                      />
                    ))}
                    <span className="ms-1.5 text-[11px] font-bold text-foreground">
                      {order.review.score}/5
                    </span>
                  </div>
                  <button
                    onClick={() => handleVote(order.review!.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors',
                      myVotes[order.review.id]
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground hover:text-foreground',
                    )}
                    title={t.markHelpful}
                  >
                    <ThumbsUp size={11} />
                    {order.review.likeCount}
                  </button>
                </div>
                {order.review.comment ? (
                  <p className="text-xs leading-relaxed text-foreground">{order.review.comment}</p>
                ) : null}
                {/* HIRFA Phase 3: photos the customer attached to this review. */}
                {order.review.images?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {order.review.images.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block h-14 w-14 overflow-hidden rounded-lg border border-border"
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}
                {/* The artisan's public reply, if any. */}
                {order.review.sellerReply ? (
                  <div className="rounded-lg bg-card p-2">
                    <p className="flex items-center gap-1 text-[10px] font-black text-primary">
                      <MessageSquareReply size={11} />
                      {t.sellerReply}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {order.review.sellerReply}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {ratingOrderId && (<CraftRatingDialog open={true} onOpenChange={(o) => { if (!o) { setRatingOrderId(null); setRatingOrderArtisan(null); } }} orderId={ratingOrderId} artisanName={ratingOrderArtisan} onSubmitted={() => load()} />)}
    </div>
  );
}