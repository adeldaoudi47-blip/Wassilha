import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import {
  canModerate,
  isModerationAction,
  moderationTargetStatus,
  type ModerationAction,
} from '@/lib/marketplace-moderation';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/products/:id/moderate  (privileged admin only)
//
// Body: { action: 'approve' | 'reject' | 'suspend' | 'restore', reason?: string }
//
// ONE endpoint for all four decisions on purpose: they share the same guards
// (admin gate, transition table, atomic compare-and-set, seller notification),
// and four separate copies of those guards would be four places to get it wrong.
//
// SECURITY — every input is server-derived; nothing is trusted from the body:
//   * identity   -> gate.session.id (never a body field)
//   * from-state -> read back from the DB row, never sent by the caller
//   * to-state   -> derived from the ACTION via the shared transition table
//   * legality   -> canModerate(from, action), else 409 (no silent rewrite)
//   * atomicity  -> updateMany with `moderationStatus: from` in the WHERE, so two
//                   admins acting at once cannot both "win" and clobber each other.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as
      | { action?: unknown; reason?: unknown }
      | null;

    const action = body?.action;
    if (!isModerationAction(action)) {
      return NextResponse.json({ error: 'invalidAction' }, { status: 400 });
    }

    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    // A rejection/suspension must be explainable to the seller: an unexplained
    // takedown is unactionable, and the seller cannot fix what they cannot read.
    if ((action === 'reject' || action === 'suspend') && reason.length < 2) {
      return NextResponse.json({ error: 'reasonRequired' }, { status: 400 });
    }

    const product = await db.craftProduct.findUnique({
      where: { id },
      select: {
        id: true,
        nameAr: true,
        moderationStatus: true,
        artisan: { select: { userId: true } },
      },
    });
    if (!product) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    const from = product.moderationStatus;
    if (!canModerate(from, action)) {
      // Echoed so the admin UI can say "already approved" instead of failing
      // with a generic message.
      return NextResponse.json({ error: 'invalidTransition', from, action }, { status: 409 });
    }

    const next = moderationTargetStatus(action);
    const clearsReason = action === 'approve' || action === 'restore';

    const result = await db.craftProduct.updateMany({
      where: { id, moderationStatus: from },
      data: {
        moderationStatus: next,
        // approve/restore carry no reason; reject/suspend record the admin's.
        moderationReason: clearsReason ? null : reason,
        moderatedAt: new Date(),
        moderatedById: gate.session.id,
      },
    });
    if (result.count === 0) {
      // The row changed between our read and our write — a concurrent admin.
      return NextResponse.json({ error: 'invalidTransition' }, { status: 409 });
    }

    notifySellerOfProductDecision({
      userId: product.artisan.userId,
      productId: product.id,
      productName: product.nameAr,
      action,
      reason,
    });

    return NextResponse.json({ ok: true, id, from, status: next });
  } catch (e) {
    console.error('[api/admin/craft/products/[id]/moderate]', e);
    // SECURITY: no raw exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

/**
 * Tell the seller what was decided, and why.
 *
 * PHASE 9 reuses the EXISTING notification path rather than inventing a second
 * delivery architecture:
 *   * `createNotification` writes the durable in-app row (and, via Phase 6,
 *     fires the `notification:new` realtime event).
 *   * `sendPushNotification` is the optional FCM nudge.
 *
 * Both are fire-and-forget and their failures are swallowed: a notification
 * outage must never undo (or fail) the moderation action the admin just
 * performed, and the product row is the authoritative record regardless.
 *
 * The Arabic text is finished copy (this repo stores `title`/`body` as final
 * Arabic) while `i18n` carries the keys + params so a future French render can
 * re-resolve the string client-side with no schema change.
 */
function notifySellerOfProductDecision(args: {
  userId: string;
  productId: string;
  productName: string;
  action: ModerationAction;
  reason: string;
}) {
  const { userId, productId, productName, action, reason } = args;

  const text: Record<
    ModerationAction,
    { title: string; body: string; titleKey: string; bodyKey: string }
  > = {
    approve: {
      title: 'تمت الموافقة على منتجك',
      body: `منتجك «${productName}» أصبح ظاهرًا في السوق.`,
      titleKey: 'productApproved',
      bodyKey: 'productApprovedBody',
    },
    reject: {
      title: 'تم رفض منتجك',
      body: `سبب الرفض: ${reason}`,
      titleKey: 'productRejected',
      bodyKey: 'productRejectedBody',
    },
    suspend: {
      title: 'تم إيقاف منتجك',
      body: `سبب الإيقاف: ${reason}`,
      titleKey: 'productSuspended',
      bodyKey: 'productSuspendedBody',
    },
    restore: {
      title: 'تمت إعادة منتجك',
      body: `منتجك «${productName}» أصبح ظاهرًا من جديد.`,
      titleKey: 'productRestored',
      bodyKey: 'productRestoredBody',
    },
  };

  const t = text[action];

  void createNotification({
    userId,
    type: 'product_moderation',
    title: t.title,
    body: t.body,
    data: {
      productId,
      i18n: { titleKey: t.titleKey, bodyKey: t.bodyKey, params: { name: productName, reason } },
    },
  }).catch((e) => console.warn('[moderation] notification failed:', e));

  void sendPushNotification(userId, t.title, t.body, {
    type: `product_${action}`,
  }).catch(() => undefined);
}