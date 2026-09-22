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
export async function findAvailableDrivers(
  cargoType: string,
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
  const driverUserIds = await findAvailableDrivers(order.cargoType);
  if (driverUserIds.length === 0) return { notified: 0 };

  const title = 'طلب جديد';
  const body = 'لديك طلب توصيل جديد، تحقق من التطبيق.';

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
          // Keys for a future French re-render client-side.
          i18n: {
            titleKey: 'notifications.newOrder.title',
            bodyKey: 'notifications.newOrder.body',
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
