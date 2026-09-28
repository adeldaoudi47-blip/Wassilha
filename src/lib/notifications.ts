import { db } from './db';
import { notificationSelect } from './dto';
import { emitNotificationNew } from './pusher-server';
import type { Prisma } from '@prisma/client';
import type { NotificationType, NotificationData } from './types';

// ---------------------------------------------------------------------------
// Single write path for the in-app notification center (Phase 1).
//
// Every future event hook (order accepted, artisan approved, system broadcast,
// ...) MUST go through createNotification(), so the row shape stays uniform
// and a push-notification layer can be layered on later without touching the
// call sites.
//
// LOCALIZATION: `title` and `body` are stored as FINISHED Arabic text (the
// app's default locale). When the caller knows the message keys it should ALSO
// pass them in `data.i18n` (`{ titleKey, bodyKey, params }`) so a future
// French render can re-resolve the strings client-side with no schema change.
//
// SECURITY: `userId` is always taken from the authenticated session at the
// call site — never from a client-supplied payload.
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  /**
   * PHASE 6: set `false` to skip the realtime `notification:new` trigger.
   *
   * The mass fan-out (`dispatch.fanOutNewOrder`) does exactly that: it already
   * delivers one `order:new-request` per eligible driver plus a single FCM
   * batch, so N additional Pusher triggers would only add latency to order
   * creation without telling anyone anything new.
   */
  realtime?: boolean;
}

// Creates one notification for one user. Returns the row as the API serves it
// (notificationSelect), so emitters can echo it to their own response.
//
// Prisma needs InputJsonValue (not JS null) for a `Json?` column, so the key
// is omitted entirely when there is no payload.
export async function createNotification(input: CreateNotificationInput) {
  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      ...(input.data
        ? { data: input.data as unknown as Prisma.InputJsonValue }
        : {}),
    },
    select: notificationSelect,
  });

  // PHASE 6 - realtime delivery, strictly AFTER the row committed (Part 3).
  //
  // A rolled-back write never reaches this line, so no "you have a
  // notification" hint can ever describe a row that does not exist. The emit is
  // fire-and-forget and swallowed: the notification center is a delivery
  // surface, and a Pusher outage must never fail the write the caller awaited.
  if (input.realtime !== false) {
    try {
      emitNotificationNew(input.userId, notification);
    } catch (e) {
      console.warn('[notifications] realtime emit failed:', e);
    }
  }

  return notification;
}
