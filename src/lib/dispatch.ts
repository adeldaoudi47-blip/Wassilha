// -----------------------------------------------------------------
// C3 — Driver fan-out for a live order.
//
// This used to be an inline block inside POST /api/orders; it was extracted
// so that the C3 dispatcher (`/api/cron/dispatch-scheduled`) can reuse the
// exact same notification path when it flips a future booking from
// `scheduled` → `searching`. Keeping one implementation means the push copy,
// the service-type filter and the notification rows can never drift between
// the two entry points.
//
// Both call sites treat the fan-out as best-effort: a FCM / DB outage must
// never prevent an order from going live, so every failure is logged and
// swallowed (the order is already `searching` in the DB by then).
// ---------------------------------------------------------------------------

import { db } from './db';
import { sendPushNotificationBatch } from './firebase-admin';
import { createNotification } from './notifications';

// Minimal projection of an Order needed to run the fan-out. Matches the
// fields POST /api/orders returns (`publicOrderSelect`), so callers can pass
// the created row straight through.
export interface DispatchableOrder {
  id: string;
  code: string;
  cargoType: string;
  pickup: string;
  dropoff: string;
  // VEHICLE-TYPE MATCHING (Phase 2): when set, only drivers whose vehicle
  // matches this category are notified. `null` / undefined = no preference,
  // which reproduces the pre-Phase-2 behaviour for every existing caller.
  requiredVehicleType?: string | null;
  // SEAT-CAPACITY MATCHING (Phase 1): copied off the order so the fan-out
  // can drop drivers whose registered vehicle has too few seats.
  requiredSeats?: number | null;
}

// Order.cargoType is a free String; translate it into the Driver.serviceType
// category the order is requesting. Unknown values fall through to the cargo
// fan-out rather than blowing up (mirrors the original inline logic).
export function serviceCategoryFor(cargoType: string): 'CARGO' | 'TAXI' {
  return cargoType === 'taxi' ? 'TAXI' : 'CARGO';
}

// Drivers eligible to receive a given order: online, verified, active
// account, and opted into the requested service category (`serviceType` is
// "BOTH" or the exact category). Backed by @@index([isOnline, isVerified, serviceType]).
//
// VEHICLE-TYPE MATCHING (Phase 2): when `requiredVehicleType` is set, the
// driver's vehicle must be in that category. This is expressed through the
// 1:1 Driver↔VehicleRegistration link (backed by
// @@index([vehicleCategory])) so a driver who never picked a category
// (legacy `vehicleCategory = null`) is excluded from a *categorical*
// request — they opted into no category, so they cannot claim to match one.
// Passing `null` / undefined skips the filter entirely and fans the order
// out to the whole eligible pool, exactly as the flow worked before Phase 2.
export async function findAvailableDrivers(
  cargoType: string,
  requiredVehicleType?: string | null,
  // SEAT-CAPACITY MATCHING (Phase 1): the minimum number of passenger seats
  // the order asks for (TAXI mode). Null = no seat requirement.
  requiredSeats?: number | null,
): Promise<string[]> {
  const requestedService = serviceCategoryFor(cargoType);
  const drivers = await db.driver.findMany({
    where: {
      isOnline: true,
      isVerified: true,
      user: { accountStatus: 'active' },
      // The `OR` shape lets a single Prisma query hit both the specialists
      // (serviceType = requestedService) and the generalists ("BOTH"). A
      // driver whose serviceType is the *opposite* of the request is
      // excluded automatically.
      OR: [{ serviceType: 'BOTH' }, { serviceType: requestedService }],
      // VEHICLE-TYPE MATCHING (Phase 2): a categorical request narrows the
      // pool to drivers whose registered vehicle is in that category.
      // Vehicles with no category on file never satisfy a categorical
      // request; orders with no preference skip this clause.
      ...(requiredVehicleType
        ? { vehicleRegistration: { vehicleCategory: requiredVehicleType } }
        : {}),
    },
    select: {
      userId: true,
      vehicleRegistration: { select: { vehicleCategory: true, seats: true } },
    },
  });
  const eligible = drivers.filter((d) =>
    isVehicleCompatible(
      { cargoType, requiredVehicleType, requiredSeats },
      d.vehicleRegistration,
    ),
  );
  // eslint-disable-next-line no-console
  console.log('[DISPATCH] Filtered drivers:', eligible.length, 'from:', drivers.length);
  return eligible.map((d) => d.userId);
}

// Fan out a now-live order to every eligible driver: one FCM batch (push)
// plus one in-app notification row per driver. Never throws.
export async function fanOutNewOrder(order: DispatchableOrder): Promise<{
  notified: number;
}> {
  const driverUserIds = await findAvailableDrivers(
    order.cargoType,
    order.requiredVehicleType ?? null,
    order.requiredSeats ?? null,
  );
  if (driverUserIds.length === 0) return { notified: 0 };

  const title = 'طلب جديد';
  // CUSTOM MESSAGE (Phase 4): the body carries the route + code, so the
  // driver can decide whether the trip is worth taking before opening the
  // app. This duplicates `newOrderBody` in the i18n table verbatim — the
  // stored Arabic text is the source of truth for push, and the i18n key is
  // only used by the notification center's French re-render.
  const body = `لديك طلب توصيل جديد من ${order.pickup} إلى ${order.dropoff} (${order.code})، تحقق من التطبيق.`;

  // One FCM call regardless of fleet size — the batch helper handles the 5s
  // timeout and dead-token pruning internally.
  void sendPushNotificationBatch(driverUserIds, title, body, {
    type: 'new_order',
    orderId: order.id,
    orderCode: order.code,
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[dispatch] driver push batch failed:', e);
  });

  // In-app notification center rows, so drivers who miss the push still see
  // the request on next app open. Written one-by-one through the single
  // write path so the row shape stays uniform; a partial failure here is
  // non-fatal (the push above already went out).
  for (const userId of driverUserIds) {
    try {
      await createNotification({
        userId,
        type: 'order',
        title,
        body,
        // PHASE 6: no per-driver `notification:new` trigger here. This loop can
        // run once per online driver, and these same drivers already receive the
        // single `order:new-request` fan-out plus one batched push; N extra
        // Pusher calls would only slow the customer's order creation down.
        realtime: false,
        data: {
          orderId: order.id,
          code: order.code,
          // Keys for a future French re-render client-side. These are the
          // FLAT keys from the translation table (the center looks them up
          // directly, not through a dotted path), and both the key and the
          // body must exist in src/lib/i18n.ts or the French render silently
          // falls back to the stored Arabic text.
          i18n: {
            titleKey: 'newOrder',
            bodyKey: 'newOrderBody',
            params: { code: order.code, pickup: order.pickup, dropoff: order.dropoff },
          },
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[dispatch] notification row failed:', e);
    }
  }

  return { notified: driverUserIds.length };
}

// ---------------------------------------------------------------------------
// PHASE 1 - VEHICLE COMPATIBILITY (single source of truth).
//
// `isVehicleCompatible` below is THE decision function: the driver fan-out
// (findAvailableDrivers), the driver's incoming feed and
// POST /api/orders/:id/accept all route through it, so a driver can never
// receive - or claim - an order their registered vehicle cannot serve.
// ---------------------------------------------------------------------------

// CARGO-CAPACITY POLICY (deliberately conservative): only a motorbike is
// excluded, and only for the three cargo types that cannot physically travel
// on two wheels. A driver with NO category on file (legacy rows) is never
// penalised, and every other category stays eligible, so no order loses
// candidates in a small fleet. Widen only with real fleet data.
export const OVERSIZED_CARGO_TYPES = ['furniture', 'appliance', 'construction'] as const;
export const UNDER_CAPACITY_VEHICLE_CATEGORIES = ['moto'] as const;

/** Vehicle-side constraints carried by an order. */
export interface OrderVehicleConstraint {
  requiredVehicleType?: string | null;
  requiredSeats?: number | null;
  cargoType?: string | null;
  // CARGO DEDICATED FLOW (Phase 4): 'small' | 'medium' | 'large'. Null /
  // absent on every pre-Phase-4 order and on taxi bookings, so the new
  // size rule below never touches legacy rows.
  cargoSize?: string | null;
}

/** Vehicle facts read off `VehicleRegistration`. */
export interface DriverVehicleFacts {
  vehicleCategory?: string | null;
  seats?: number | null;
}
/**
 * Does this driver's registered vehicle satisfy the order's requirements?
 * Null / undefined on either side means "not specified" and never blocks a
 * match - that is what keeps every pre-Phase-1 order working unchanged.
 *
 * Rules, in order:
 *   1. a categorical request matches only that exact category;
 *   2. a seat request needs `seats >= requiredSeats` (a vehicle with no seat
 *      count on file cannot satisfy it);
 *   3. the cargo-capacity policy above.
 */
export function isVehicleCompatible(
  order: OrderVehicleConstraint,
  vehicle: DriverVehicleFacts | null | undefined,
): boolean {
  const category = vehicle?.vehicleCategory ?? null;
  const seats = typeof vehicle?.seats === 'number' ? vehicle.seats : null;

  // (1) Vehicle category ("moto", "truck", "taxi_car_7", ...).
  if (order.requiredVehicleType && category !== order.requiredVehicleType) {
    return false;
  }

  // (2) Seat capacity (TAXI).
  if (typeof order.requiredSeats === 'number' && order.requiredSeats > 0) {
    if (seats === null || seats < order.requiredSeats) return false;
  }

  // (3) Cargo capacity: oversized goods never reach a motorbike.
  if (
    order.cargoType &&
    (OVERSIZED_CARGO_TYPES as readonly string[]).includes(order.cargoType) &&
    category !== null &&
    (UNDER_CAPACITY_VEHICLE_CATEGORIES as readonly string[]).includes(category)
  ) {
    return false;
  }

  // (4) CARGO DEDICATED FLOW (Phase 4): a "large" shipment is truck-scale
  // and never travels on two wheels, whatever the cargoType says. Same
  // conservative posture as rule (3): a vehicle with no category on file
  // is never penalised, and only motorbikes are excluded.
  if (
    order.cargoSize === 'large' &&
    category !== null &&
    (UNDER_CAPACITY_VEHICLE_CATEGORIES as readonly string[]).includes(category)
  ) {
    return false;
  }

  return true;
}
