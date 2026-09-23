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
            {order.deliveryOption === 'wassilha_delivery' && (<div className="flex items-center gap-2 rounded-lg bg-blue-50 p-2 dark:bg-blue-950/20"><Truck size={14} className="text-blue-600" /><span className="text-xs font-semibold text-blue-700">{t.wassilhaDelivery}</span></div>)}
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