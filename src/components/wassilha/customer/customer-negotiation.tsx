'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, X, Scale, Loader2, BadgeCheck, ArrowLeftRight, ChevronDown, ChevronUp, History } from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDzd } from '@/lib/wassilha-data';
import { cn } from '@/lib/utils';
import type { Order, OrderOffer } from '@/lib/types';
import { ORDER_OFFER_STATUS_LABELS, OFFER_EVENT_LABEL_KEYS } from '@/lib/types';
import { onOfferEvent } from '@/lib/realtime';
import {
  shouldApplyOfferEvent,
  offerFromRealtimeEvent,
  shouldNotifyOnce,
} from '@/lib/realtime-merge';

/**
 * NEGOTIATION ENGINE (Phase 4): `t` is typed as the full dictionary, so a
 * journal row label (whose key comes from `OFFER_EVENT_LABEL_KEYS` at
 * runtime) needs a widened lookup. Falling back to the raw key keeps a
 * future event type visible instead of crashing the card.
 */
const labelFor = (t: object, key: string): string =>
  (t as Record<string, string>)[key] ?? key;

// PRICE NEGOTIATION (Phase 3) — the customer's list of drivers' price offers
// for one order. Shown inside the tracking screen while the order is still
// `searching` and the customer opted into negotiation.
//
// Behaviour:
//   - loads via GET /api/orders/:id/offers (customer-scoped server-side), and
//     refreshes on a short interval while live so a driver's late offer
//     appears without a reload,
//   - accepting one offer claims the order for that driver and stamps the
//     agreed price; the parent is notified via `onAccepted` so it can flip
//     to the "driver found" view,
//   - rejecting an offer leaves the order `searching` so the remaining
//     offers stay comparable.
export function CustomerNegotiation({
  order,
  onAccepted,
}: {
  order: Order;
  onAccepted?: (updated: Order) => void;
}) {
  const { t, isAr } = useT();
  const [offers, setOffers] = useState<OrderOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // COUNTER (Phase 3): the offer the customer is replying to, and the amount
  // they typed. A null `counterFor` closes the dialog.
  const [counterFor, setCounterFor] = useState<OrderOffer | null>(null);
  const [counterPrice, setCounterPrice] = useState('');

  // NEGOTIATION ENGINE (Phase 4): which offer cards have their price journal
  // expanded. The journal ships with the offer list (`offer.events`), so
  // expanding is instant and costs no request.
  const [openJournal, setOpenJournal] = useState<Record<string, boolean>>({});

  // Offers can only arrive while the order is live. Once accepted the
  // settled list stays visible (read-only) but we stop polling.
  const live = order.status === 'searching';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await api.listOrderOffers(order.id);
        if (!cancelled) setOffers(list);
      } catch {
        /* ignore — the list is best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    if (!live) return () => { cancelled = true; };
    // PHASE 6: 6s -> 30s. `offer:new` / `offer:update` now deliver this list
    // live, so the poll is only the degraded path (Pusher unreachable, tab
    // asleep, connection capped). Running both at 6s was the duplication Part 21
    // warns about; 30s keeps recovery bounded without competing with realtime.
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [order.id, live]);

  // PHASE 6 (Part 4 - negotiation realtime): a driver bid, countered an existing
  // offer, or an offer the customer made was declined — all arrive on this
  // order's channel, which only this order's customer, its assigned driver and
  // an admin can sign. The customer's own counter is mirrored back here
  // (`alsoOrder` in pusher-server) so her second tab converges too.
  //
  // Realtime is a HINT here: a new bid is merged optimistically so the card
  // appears instantly, then the (relaxed) poll refetches the full rows with
  // their journals. `shouldApplyOfferEvent` drops a delivery older than what we
  // already applied for that offer (Part 13).
  const latestOfferAt = useRef<Map<string, string>>(new Map());
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!live) return;
    const off = onOfferEvent(order.id, (event) => {
      if (!shouldApplyOfferEvent(latestOfferAt.current, event)) return;
      setOffers((prev) => {
        const index = prev.findIndex((o) => o.id === event.offerId);
        if (index === -1) return [offerFromRealtimeEvent(event), ...prev];
        const next = [...prev];
        next[index] = offerFromRealtimeEvent(event, prev[index]);
        return next;
      });
      // Part 10: only a genuinely NEW bid is worth interrupting the customer
      // for. A counter arriving on an offer she is already looking at, or a
      // re-delivery of either, must not ring.
      if (event.kind !== 'new') return;
      if (!shouldNotifyOnce(notifiedRef.current, `offer:${event.offerId}:new`)) return;
      toast.info(t.newOffer);
    });
    return off;
  }, [order.id, live, t.newOffer]);

  const handleAccept = async (offer: OrderOffer) => {
    setActing(offer.id);
    try {
      const { order: updated } = await api.acceptOrderOffer(order.id, offer.id);
      // Settle the list locally so it matches the server without a refetch:
      // the winner is accepted, every other pending offer is rejected.
      setOffers((prev) =>
        prev.map((o) =>
          o.id === offer.id
            ? { ...o, status: 'accepted' }
            : o.status === 'pending'
              ? { ...o, status: 'rejected' }
              : o,
        ),
      );
      toast.success(t.offerAcceptedToast);
      // NEGOTIATION ENGINE (Phase 4): refresh so the journal shows the
      // settlement rows (accepted + auto-rejected alternatives) if the list
      // stays on screen. Best-effort — the claim itself already committed.
      try {
        setOffers(await api.listOrderOffers(order.id));
      } catch { /* ignore — best-effort refresh */ }
      onAccepted?.(updated);
    } catch (err) {
      // `notAvailable` (someone else claimed it) / `offerNotPending` are the
      // expected races; the raw code is shown so the customer knows why.
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || (isAr ? 'فشل القبول' : 'Échec'));
      // A race likely means the list is stale — refresh it.
      try {
        setOffers(await api.listOrderOffers(order.id));
      } catch { /* ignore */ }
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (offer: OrderOffer) => {
    setActing(offer.id);
    try {
      const settled = await api.rejectOrderOffer(order.id, offer.id);
      setOffers((prev) => prev.map((o) => (o.id === settled.id ? settled : o)));
      toast.success(t.offerRejectedToast);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || (isAr ? 'فشل' : 'Échec'));
    } finally {
      setActing(null);
    }
  };

  // COUNTER (Phase 3): send the customer's price back to the driver. The
  // server flips the offer to `countered` and stores `counterPrice`, so the
  // local list is settled from the response (no refetch) and the card
  // switches to the "awaiting driver reply" state.
  const handleCounter = async () => {
    if (!counterFor) return;
    const price = Number(counterPrice);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error(isAr ? 'أدخل سعراً صحيحاً' : 'Prix invalide');
      return;
    }
    setActing(counterFor.id);
    try {
      const settled = await api.counterOrderOffer(order.id, counterFor.id, price);
      setOffers((prev) =>
        prev.map((o) => (o.id === settled.id ? { ...o, ...settled } : o)),
      );
      // NEGOTIATION ENGINE (Phase 4): the counter route returns the offer
      // row without its journal, so refetch to pull the appended event. The
      // optimistic merge above already covers the visible state.
      try {
        setOffers(await api.listOrderOffers(order.id));
      } catch { /* ignore — best-effort refresh */ }
      toast.success(t.counterSent);
      setCounterFor(null);
      setCounterPrice('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || (isAr ? 'فشل' : 'Échec'));
    } finally {
      setActing(null);
    }
  };

  // Nothing to negotiate: render nothing (not even a header) when the order
  // is not negotiable, so the tracking screen is unchanged for the
  // fixed-price flow.
  if (!order.isNegotiable) return null;

  const pending = offers.filter((o) => o.status === 'pending');

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale size={16} className="text-amber-600" />
          <p className="text-sm font-bold text-foreground">{t.offersTitle}</p>
        </div>
        {live && pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {pending.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : offers.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {t.offersEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {offers.map((offer) => {
            const isPending = offer.status === 'pending';
            const isAccepted = offer.status === 'accepted';
            const isCountered = offer.status === 'countered';
            const label = (ORDER_OFFER_STATUS_LABELS[offer.status] ?? {
              ar: offer.status,
              fr: offer.status,
            })[isAr ? 'ar' : 'fr'];
            return (
              <div
                key={offer.id}
                className="space-y-1.5 rounded-xl bg-muted/40 p-2.5"
              >
                <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  {offer.driver?.avatar ? (
                    <AvatarImage src={offer.driver.avatar} alt={offer.driver.name} />
                  ) : null}
                  <AvatarFallback>
                    {offer.driver?.name?.charAt(0) ?? '؟'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-bold text-foreground">
                    {offer.driver?.name ?? t.driver}
                    {isAccepted && (
                      <BadgeCheck size={12} className="text-emerald-600" />
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t.offerFrom} · {label}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      isAccepted
                        ? 'text-base font-black text-emerald-600'
                        : 'text-base font-black text-primary'
                    }
                    dir="ltr"
                  >
                    {formatDzd(offer.price)} {t.dzd}
                  </span>
                  {isPending && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 px-2.5 hover:bg-emerald-700"
                        onClick={() => handleAccept(offer)}
                        disabled={acting === offer.id}
                      >
                        {acting === offer.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} className="me-1" />
                        )}
                        {t.acceptOffer}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-primary"
                        onClick={() => {
                          setCounterFor(offer);
                          setCounterPrice(String(offer.price));
                        }}
                        disabled={acting === offer.id}
                        aria-label={t.counterOffer}
                      >
                        <ArrowLeftRight size={13} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-destructive px-2 text-destructive"
                        onClick={() => handleReject(offer)}
                        disabled={acting === offer.id}
                        aria-label={t.rejectOffer}
                      >
                        <X size={13} />
                      </Button>
                    </div>
                  )}
                </div>
                </div>
                {isCountered && (
                  // The customer's own counter is echoed back with a
                  // "waiting for the driver" hint, so they know the ball is
                  // not in their court anymore.
                  <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5 dark:bg-amber-950/30">
                    <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                      {t.awaitingDriverReply}
                    </p>
                    <span
                      className="text-sm font-black text-amber-700 dark:text-amber-300"
                      dir="ltr"
                    >
                      {formatDzd(offer.counterPrice ?? 0)} {t.dzd}
                    </span>
                  </div>
                )}

                {/* NEGOTIATION ENGINE (Phase 4): the price journal. Every
                     driver offer and customer counter of this negotiation,
                     oldest first, so the card shows the whole conversation
                     instead of only the last position. Collapsed by default
                     to keep the list scannable; the journal already arrived
                     with the list, so expanding costs nothing. */}
                {offer.events && offer.events.length > 0 && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenJournal((prev) => ({ ...prev, [offer.id]: !prev[offer.id] }))
                      }
                      aria-expanded={!!openJournal[offer.id]}
                      className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {openJournal[offer.id] ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                      <History size={11} />
                      {t.offerTimelineTitle}
                      <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-bold">
                        {offer.events.length}
                      </span>
                    </button>
                    {openJournal[offer.id] && (
                      <ol className="space-y-1 rounded-lg bg-background/70 p-2">
                        {offer.events.map((ev) => {
                          const settled = ev.type === 'accepted' || ev.type === 'rejected';
                          return (
                            <li
                              key={ev.id}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span
                                className={
                                  ev.type === 'accepted'
                                    ? 'font-bold text-emerald-600'
                                    : ev.type === 'rejected'
                                      ? 'text-muted-foreground line-through'
                                      : ev.type === 'customer_counter'
                                        ? 'font-medium text-amber-700 dark:text-amber-300'
                                        : 'text-foreground'
                                }
                              >
                                {labelFor(t, OFFER_EVENT_LABEL_KEYS[ev.type] ?? ev.type)}
                              </span>
                              <span className="flex items-center gap-2">
                                {ev.price != null && (
                                  <span
                                    className={cn(
                                      'font-bold',
                                      settled ? 'text-muted-foreground' : 'text-foreground',
                                    )}
                                    dir="ltr"
                                  >
                                    {formatDzd(ev.price)} {t.dzd}
                                  </span>
                                )}
                                <span className="text-[9px] text-muted-foreground" dir="ltr">
                                  {new Date(ev.createdAt).toLocaleTimeString(
                                    isAr ? 'ar-DZ' : 'fr-FR',
                                    { hour: '2-digit', minute: '2-digit' },
                                  )}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* COUNTER (Phase 3): the customer replies with their own price. The
         field is pre-filled with the driver's price so the counter starts
         from a sane baseline; submitting flips the card to "countered". */}
      <Dialog open={!!counterFor} onOpenChange={(o) => !o && setCounterFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.counterOffer}</DialogTitle>
            <DialogDescription>
              {counterFor
                ? `${t.offerFrom} ${counterFor.driver?.name ?? t.driver} · ${formatDzd(counterFor.price)} ${t.dzd}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="counter-price">{t.yourOffer}</Label>
            <Input
              id="counter-price"
              type="number"
              inputMode="numeric"
              min={50}
              max={100000}
              value={counterPrice}
              onChange={(e) => setCounterPrice(e.target.value)}
              placeholder={t.counterOfferHint}
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground">
              {t.counterOfferHint}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCounterFor(null)}>
              {t.cancel}
            </Button>
            <Button
              onClick={handleCounter}
              disabled={acting === counterFor?.id || !counterPrice}
            >
              {acting === counterFor?.id ? (
                <Loader2 size={14} className="me-1 animate-spin" />
              ) : (
                <ArrowLeftRight size={14} className="me-1" />
              )}
              {t.negotiatePrice}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
