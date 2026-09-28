// ---------------------------------------------------------------------------
// PHASE 6 - realtime merge helpers (pure, transport-agnostic, no React).
//
// Realtime delivery is at-least-once and can arrive out of order. Screens
// therefore never assign event payloads straight into state; they go through
// these helpers, which provide the three guarantees this phase is graded on:
//
//   * DUPLICATES (Part 12) - everything is keyed by id, so a re-delivered event
//     replaces a row instead of adding a second card, and a toast fires once.
//   * OUT-OF-ORDER (Part 13) - the order status rank refuses to move a screen
//     backwards, except into a terminal state, so a late `accepted` can never
//     overwrite a `picked`.
//   * LATE FAN-OUT (Part 6) - a driver's feed refuses to re-add an order whose
//     claim window already closed.
//
// Realtime is a synchronisation HINT: the REST row stays authoritative, which is
// why every screen also keeps a (relaxed) safety poll and refetches on
// reconnect rather than trusting the event stream alone.
//
// Imported by components AND by src/scripts/verify-phase6.ts, so these
// guarantees are unit-tested rather than asserted by eye.
// ---------------------------------------------------------------------------

import type { Order, OrderOffer, RealtimeOfferEvent } from './types';

// Lower rank = earlier in the life of an order. `scheduled` shares rank 0 with
// `searching` because an unclaimed reservation is still an open order; the two
// terminal states share the top rank.
const STATUS_RANK: Record<string, number> = {
  searching: 0,
  scheduled: 0,
  accepted: 1,
  picked: 2,
  delivered: 3,
  cancelled: 3,
};

export function orderStatusRank(status: string): number {
  return STATUS_RANK[status] ?? 0;
}

export function isTerminalOrderStatus(status: string): boolean {
  return status === 'delivered' || status === 'cancelled';
}

/** A status a driver may still claim (mirrors the server's own gate). */
export function isClaimableOrderStatus(status: string): boolean {
  return status === 'searching' || status === 'scheduled';
}

/**
 * Apply an order row that arrived over the wire (or from a refetch).
 *
 * Returns the row to keep: the incoming one when it is safe to apply, the
 * current one when the delivery is stale. Callers always use the return value
 * (`setOrder((prev) => applyOrderEvent(prev, incoming))`), so a duplicate or a
 * late event becomes a no-op instead of a regression.
 */
export function applyOrderEvent(
  current: Order | null,
  incoming: Order | null | undefined,
): Order | null {
  if (!incoming || typeof incoming.id !== 'string') return current;
  if (!current) return incoming;
  // A payload for a different order is a routing bug, never a merge.
  if (current.id !== incoming.id) return current;

  // Terminal states are final: the last one wins, and nothing can leave them.
  if (isTerminalOrderStatus(incoming.status)) return incoming;
  if (isTerminalOrderStatus(current.status)) return current;

  // Otherwise never move backwards (a late `accepted` must not undo a `picked`).
  if (orderStatusRank(incoming.status) < orderStatusRank(current.status)) {
    return current;
  }
  return incoming;
}

/** Insert-or-replace by id. New rows go to the front of the list. */
export function upsertById<T extends { id: string }>(list: T[], incoming: T): T[] {
  const index = list.findIndex((row) => row.id === incoming.id);
  if (index === -1) return [incoming, ...list];
  const next = list.slice();
  next[index] = incoming;
  return next;
}

/**
 * The driver's `myOffers` index is keyed by `orderId` (one live bid per driver
 * per order), so an event upserts the entry for its order instead of appending.
 */
export function upsertOfferByOrderId(
  index: Record<string, OrderOffer>,
  incoming: OrderOffer,
): Record<string, OrderOffer> {
  return { ...index, [incoming.orderId]: incoming };
}

/**
 * Convert a realtime offer event into the row shape the lists render,
 * PRESERVING the REST-only joins (driver identity, negotiation journal) when the
 * list already had them, so an event never blanks out data it did not carry.
 */
export function offerFromRealtimeEvent(
  event: RealtimeOfferEvent,
  previous?: OrderOffer,
): OrderOffer {
  const base: OrderOffer =
    previous ??
    ({
      id: event.offerId,
      orderId: event.orderId,
      driverId: event.driverId,
      price: event.price,
      status: event.status,
      createdAt: event.at,
    } as OrderOffer);

  return {
    ...base,
    id: event.offerId,
    orderId: event.orderId,
    driverId: event.driverId,
    price: event.price,
    status: event.status,
    counterPrice: event.counterPrice,
    updatedAt: event.at,
    // `driverName` is the delivery-only fallback (see types.ts): the REST join
    // wins when present, and a brand-new bid still renders a name immediately.
    driverName: base.driver?.name ?? event.driverName ?? base.driverName ?? null,
  };
}

/**
 * Ordering guard for one offer id: ISO-8601 strings compare lexicographically,
 * so a delivery older than the last one applied for that offer is dropped. An
 * identical timestamp is allowed through - the merge is idempotent anyway.
 */
export function shouldApplyOfferEvent(
  latestAt: Map<string, string>,
  event: { offerId: string; at: string },
): boolean {
  const previous = latestAt.get(event.offerId);
  if (previous && previous > event.at) return false;
  latestAt.set(event.offerId, event.at);
  return true;
}

/**
 * Toast de-duplication: `true` the FIRST time a key is seen this session. Keys
 * are content-stable (`offer:<id>:new`, `order:<id>:picked`), so a re-delivered
 * event cannot double-toast. The set stays bounded by dropping its oldest entry
 * (a Set preserves insertion order).
 */
export function shouldNotifyOnce(seen: Set<string>, key: string, cap = 200): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  while (seen.size > cap) {
    const oldest = seen.values().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
  return true;
}

/**
 * May this order card enter a driver's incoming feed?
 *
 * `order:new-request` is fire-and-forget, so it can land AFTER the order was
 * claimed or cancelled. The feed therefore refuses any order it has already seen
 * leave the claimable window, and re-checks the status inside the payload.
 */
export function shouldAcceptIncomingOrder(
  order: Pick<Order, 'id' | 'status'> | null | undefined,
  settledOrderIds: Set<string>,
): boolean {
  if (!order || typeof order.id !== 'string') return false;
  if (settledOrderIds.has(order.id)) return false;
  return isClaimableOrderStatus(order.status);
}

/**
 * Remember that an order left the claimable window (claimed, delivered or
 * cancelled). Bounded so a long shift cannot grow the set without limit.
 */
export function rememberSettledOrder(
  settledOrderIds: Set<string>,
  orderId: string,
  cap = 200,
): void {
  settledOrderIds.add(orderId);
  while (settledOrderIds.size > cap) {
    const oldest = settledOrderIds.values().next().value;
    if (oldest === undefined) break;
    settledOrderIds.delete(oldest);
  }
}
