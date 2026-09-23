// ---------------------------------------------------------------------------
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
    select: { userId: true },
  });
  return drivers.map((d) => d.userId);
}

// Fan out a now-live order to every eligible driver: one FCM batch (push)
// plus one in-app notification row per driver. Never throws.
export async function fanOutNewOrder(order: DispatchableOrder): Promise<{
  notified: number;
}> {
  const driverUserIds = await findAvailableDrivers(
    order.cargoType,
    order.requiredVehicleType ?? null,
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
