'use client';

import { useEffect, useState } from 'react';
import { Check, X, Clock, Package, Loader2, ShoppingBag, Star, ThumbsUp, MessageSquareReply } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '../skeleton';
import { cn } from '@/lib/utils';
import type { CraftOrderPublic, CraftOrderStatus } from '@/lib/types';

// HIRFA (P6): artisan order management. Lists orders for the artisan's
// shop with status-aware action buttons (accept / reject / mark ready).
export function ArtisanOrders() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<CraftOrderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  // HIRFA Phase 3: the review the artisan is currently typing a reply to.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);
  // HIRFA Phase 3: this session's "helpful" votes, for optimistic counts.
  const [myVotes, setMyVotes] = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    api.getCraftOrders()
      .then((res) => setOrders(res.orders))
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: CraftOrderStatus) => {
    setActing(id);
    try {
      await api.updateCraftOrderStatus(id, status);
      toast.success(status === 'confirmed' ? t.acceptOrder : status === 'cancelled' ? t.orderCancelled : status === 'ready' ? t.markReady : t.markDelivered);
      load();
    } catch {
      toast.error(isAr ? 'فشل تحديث الطلب' : 'Échec de la mise à jour');
    } finally {
      setActing(null);
    }
  };

  // HIRFA Phase 3: reply to a buyer review. The API verifies the artisan
  // owns the review's order (IDOR guard), so this screen can only ever
  // answer reviews addressed to THIS store.
  const handleReply = async (reviewId: string) => {
    const draft = replyDraft.trim();
    if (draft.length < 1) {
      toast.error(t.replyEmpty);
      return;
    }
    setReplying(true);
    try {
      await api.replyCraftReview(reviewId, draft);
      // Patch the reply into the local order list (no refetch needed, and the
      // likeCount/images stay untouched).
      setOrders((prev) =>
        prev.map((o) =>
          o.review?.id === reviewId
            ? { ...o, review: { ...o.review, sellerReply: draft } }
            : o,
        ),
      );
      setReplyDraft('');
      setReplyingTo(null);
      toast.success(t.replySent);
    } catch {
      toast.error(isAr ? 'تعذر إرسال الرد' : 'Réponse impossible');
    } finally {
      setReplying(false);
    }
  };

  // HIRFA Phase 3: cast a "helpful" vote on a review (idempotent toggle).
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
      // Best-effort vote: stay silent on failure.
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300';
      case 'confirmed': return 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300';
      case 'ready': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300';
      case 'delivered': return 'bg-green-100 text-green-800 dark:bg-green-950/70 dark:text-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return isAr ? 'قيد الانتظار' : 'En attente';
      case 'confirmed': return isAr ? 'مؤكد' : 'Confirmé';
      case 'ready': return isAr ? 'جاهز' : 'Prêt';
      case 'delivered': return isAr ? 'تم التسليم' : 'Livré';
      case 'cancelled': return isAr ? 'ملغى' : 'Annulé';
      default: return status;
    }
  };

  if (loading) {
    return (<div className="space-y-3"><ListSkeleton count={3} /></div>);
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package size={48} className="text-muted-foreground/30" />
        <p className="mt-4 text-sm text-muted-foreground">{isAr ? 'لا توجد طلبات بعد' : 'Aucune commande pour le moment'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
        <Clock size={18} className="text-primary" />
        {t.newOrder}
      </h2>

      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{order.code}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ')}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor(order.status)}`}>
                {statusLabel(order.status)}
              </span>
            </div>

            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs font-bold text-foreground">{t.customerName}: {order.customer.name}</p>
              <p className="text-xs text-muted-foreground" dir="ltr">📞 {order.customer.phone}</p>
            </div>

            <div className="space-y-1.5">
              {order.items.map((item) => {
                const name = isAr ? item.product.nameAr : item.product.nameFr || item.product.nameAr;
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-foreground">
                      {item.product.images?.[0] ? (
                        <img src={item.product.images[0]} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <ShoppingBag size={14} className="text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        {name} <span className="text-muted-foreground">×{item.quantity}</span>
                        {/* HIRFA Phase 3: the chosen variant (null when the
                            product has none, or the variant was deleted after
                            delivery — onDelete: SetNull keeps the line). */}
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

            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs font-bold text-foreground">{t.total}</span>
              <span className="text-sm font-black text-primary">{order.totalPrice} {t.currencyDzd}</span>
            </div>

            {/* HIRFA Phase 3: the buyer's review — stars, photos, a "helpful"
                count the artisan can also vote, and the artisan's public
                reply. The reply API guards ownership server-side (IDOR), so
                only this store's reviews are answerable here. */}
            {order.review ? (
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={12}
                        className={cn(
                          i < order.review!.score
                            ? 'text-amber-400'
                            : 'text-muted-foreground/30',
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
                {/* HIRFA Phase 3: review photos (URLs stored server-side; the
                    rating API validated + capped them). */}
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
                {/* The artisan's reply, or the reply composer. */}
                {order.review.sellerReply ? (
                  <div className="rounded-lg bg-card p-2">
                    <p className="text-[10px] font-black text-primary">{t.sellerReply}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {order.review.sellerReply}
                    </p>
                  </div>
                ) : replyingTo === order.review.id ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder={t.replyPlaceholder}
                      maxLength={1000}
                      rows={2}
                      className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyDraft('');
                        }}
                        disabled={replying}
                        className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
                      >
                        {isAr ? 'إلغاء' : 'Annuler'}
                      </button>
                      <button
                        onClick={() => handleReply(order.review!.id)}
                        disabled={replying || !replyDraft.trim()}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                      >
                        {replying ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <MessageSquareReply size={11} />
                        )}
                        {t.sellerReply}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setReplyingTo(order.review!.id);
                      setReplyDraft('');
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <MessageSquareReply size={11} />
                    {t.replyToReview}
                  </button>
                )}
              </div>
            ) : null}

            {order.status === 'pending' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => updateStatus(order.id, 'confirmed')}
                  disabled={acting === order.id}
                  className="flex-1 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  {acting === order.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} className="me-1" />}
                  {t.acceptOrder}
                </Button>
                <Button
                  onClick={() => updateStatus(order.id, 'cancelled')}
                  disabled={acting === order.id}
                  variant="outline"
                  className="flex-1 rounded-xl border-red-200 text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  <X size={14} className="me-1" />
                  {t.rejectOrder}
                </Button>
              </div>
            )}

            {order.status === 'confirmed' && (
              <Button
                onClick={() => updateStatus(order.id, 'ready')}
                disabled={acting === order.id}
                className="w-full rounded-xl bg-sky-600 text-xs font-bold text-white hover:bg-sky-700"
              >
                {acting === order.id ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} className="me-1" />}
                {t.markReady}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
