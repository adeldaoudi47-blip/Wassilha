// ---------------------------------------------------------------------------
// PHASE 7A — MARKETPLACE -> WASSILHA DELIVERY BRIDGE.
//
// A customer who buys from ركن حرفة and wants the goods brought home gets a
// REAL Wassilha transport Order. There is no second delivery system: this file
// creates the same `Order` row `POST /api/orders` creates, so the existing
// Phase 1-6 machinery owns it end to end —
//   * `computeOrderPrice()` decides the fare (server-side, never a client price)
//   * `fanOutNewOrder()` does the push + in-app notifications
//   * `emitOrderNewRequest()` + `findAvailableDrivers()` do the realtime event
//   * `isVehicleCompatible()` filters who may take it
//
// PRICE SEPARATION (never mixed):
//   CraftOrder.totalPrice = product subtotal (marketplace money)
//   Order.price           = delivery fare (transport money)
//   Order.finalPrice      = negotiated delivery fare, if the driver bids
// Driver earnings are `finalPrice ?? price` — i.e. the DELIVERY fee only, so a
// seller is never paid out of the driver's fare and vice-versa.
//
// WHY THE ORDER IS CREATED AT CHECKOUT (not when the seller marks it "ready"):
// the delivery destination belongs to the CUSTOMER, and it must be captured
// where the customer is present. Writing it onto CraftOrder would also expose
// the customer's home address to the seller; keeping it only on the transport
// Order confines it to the assigned driver / customer / admin, which is exactly
// the Phase 5 location-privacy posture.
// ---------------------------------------------------------------------------
import type { Prisma } from '@prisma/client';
import { computeOrderPrice } from './pricing';
import { GUERRARA_CENTER, generateOrderCode } from './wassilha-data';
import { CARGO_SIZE_WEIGHT } from './types';
import type { CargoKey } from './types';

/** Marketplace goods travel as ordinary cargo; 'goods' carries a pricing multiplier. */
const DELIVERY_CARGO_TYPE: CargoKey = 'goods';

/**
 * Server-side coordinate resolution — IDENTICAL to `resolveCoord()` in
 * `POST /api/orders`: a real finite number wins, anything else falls back to
 * the city centroid so the non-nullable Order columns never throw. This is a
 * display/geo fallback only; bad numerics are rejected before we get here.
 */
function resolveCoord(value: number | null | undefined, axis: 'lat' | 'lng'): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return axis === 'lat' ? GUERRARA_CENTER.lat : GUERRARA_CENTER.lng;
}

/** Human-readable pickup built ONLY from what the store already stores. */
function buildPickupLabel(store: {
  addressAr: string | null;
  area: { nameAr: string } | null;
}): string {
  if (store.addressAr && store.addressAr.trim().length >= 2) {
    return store.addressAr.trim();
  }
  if (store.area?.nameAr) return `${store.area.nameAr} - القرارة`;
  return `متجر ركن حرفة - القرارة`;
}

export interface CreateDeliveryOrderArgs {
  /** The transaction client, so the transport Order and the link commit together. */
  tx: Prisma.TransactionClient;
  craftOrderId: string;
  craftOrderCode: string;
  /** Customer who bought the goods — derived server-side, never from the client. */
  customerId: string;
  /** Store that sells the goods — derived from product ownership server-side. */
  storeId: string;
  /** Customer destination, supplied at checkout by the customer. */
  dropoffAddress: string;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
}

/**
 * Create the Wassilha transport Order for a marketplace order and link it back.
 * MUST be called inside the caller's `$transaction`, so a failure anywhere in
 * checkout rolls the transport Order back together with the CraftOrder.
 *
 * Returns null when the CraftOrder already has a delivery Order (idempotent —
 * a duplicate checkout never produces a second driver job).
 */
export async function createCraftDeliveryOrder(
  args: CreateDeliveryOrderArgs,
): Promise<{ id: string; code: string } | null> {
  const {
    tx, craftOrderId, craftOrderCode, customerId, storeId,
    dropoffAddress, dropoffLat, dropoffLng,
  } = args;

  // IDEMPOTENCY (server-side, mandatory): one CraftOrder -> at most one
  // transport Order. `deliveryOrderId` is additionally @unique in the schema,
  // so even a lost race cannot persist a second link.
  const existing = await tx.craftOrder.findUnique({
    where: { id: craftOrderId },
    select: { deliveryOrderId: true },
  });
  if (existing?.deliveryOrderId) return null;

  const store = await tx.artisanProfile.findUnique({
    where: { id: storeId },
    select: {
      addressAr: true,
      latitude: true,
      longitude: true,
      area: { select: { nameAr: true } },
    },
  });
  if (!store) {
    // The seller vanished mid-checkout; abort rather than invent a pickup.
    throw new Error('storeNotFound');
  }

  const pickup = buildPickupLabel(store);
  const pickupLat = resolveCoord(
    store.latitude === null ? null : Number(store.latitude), 'lat',
  );
  const pickupLng = resolveCoord(
    store.longitude === null ? null : Number(store.longitude), 'lng',
  );
  const dropoffLatResolved = resolveCoord(dropoffLat, 'lat');
  const dropoffLngResolved = resolveCoord(dropoffLng, 'lng');

  // SERVER-COMPUTED fare — the client's word is never involved.
  const { price, distanceKm } = await computeOrderPrice({
    pickupLat, pickupLng,
    dropoffLat: dropoffLatResolved,
    dropoffLng: dropoffLngResolved,
    cargoType: DELIVERY_CARGO_TYPE,
  });

  // Unique code, same collision-avoidance shape as POST /api/orders.
  let code = generateOrderCode();
  let attempts = 0;
  while ((await tx.order.count({ where: { code } })) > 0) {
    code = generateOrderCode();
    if (++attempts > 10) throw new Error('codeGenFailed');
  }

  // `cargoSize: 'small'` is chosen HERE, server-side, never taken from the
  // client. It drives CARGO_SIZE_WEIGHT (the weight below) and the Phase 4
  // oversized rule inside isVehicleCompatible.
  const cargoSize = 'small' as const;

  const order = await tx.order.create({
    data: {
      code,
      customerId,
      cargoType: DELIVERY_CARGO_TYPE,
      pickup,
      dropoff: dropoffAddress,
      pickupLat,
      pickupLng,
      dropoffLat: dropoffLatResolved,
      dropoffLng: dropoffLngResolved,
      weight: CARGO_SIZE_WEIGHT[cargoSize],
      distance: distanceKm,
      price,
      status: 'searching',
      // Phase 4 policy, applied verbatim: a CARGO job is ALWAYS negotiable, so
      // the delivery fee can be agreed through the existing Offer/OfferEvent
      // engine. `finalPrice` then holds the agreed DELIVERY fee only.
      isNegotiable: true,
      // No customer vehicle preference for a marketplace parcel, so matching
      // falls back to the existing serviceType + compatibility rules.
      requiredVehicleTypes: [],
      cargoSize,
      notes: `توصيل طلب ركن حرفة ${craftOrderCode}`,
    },
    select: { id: true, code: true },
  });

  // Conditional link: only write the id while it is still null, so two racing
  // checkouts cannot both believe they own the link.
  const linked = await tx.craftOrder.updateMany({
    where: { id: craftOrderId, deliveryOrderId: null },
    data: { deliveryOrderId: order.id },
  });
  if (linked.count === 0) {
    throw new Error('deliveryLinkLost');
  }

  return order;
}
