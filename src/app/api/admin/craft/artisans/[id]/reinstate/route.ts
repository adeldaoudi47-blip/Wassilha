import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { canModerateStore } from '@/lib/marketplace-moderation';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/artisans/:id/reinstate
// Admin-only (privileged admin gate). Returns a SUSPENDED store to "active".
//
// This is the inverse of ../suspend and reuses the same one status field, so
// reinstating re-opens both seller writes and the public storefront at once.
//
// The suspension record is CLEARED (not just overwritten): leaving a stale
// `suspensionReason` on a live store would misinform the seller dashboard and
// any future audit into believing the store is still restricted.
//
// No reason is required here — reinstating is a correction, not a penalty.
// Any open reports against the store are deliberately LEFT ALONE: this endpoint
// moderates one store and must not silently discard human review work.
export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const store = await db.artisanProfile.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true },
    });
    if (!store) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    if (!canModerateStore(store.status, 'reinstate')) {
      return NextResponse.json({ error: 'invalidTransition', from: store.status }, { status: 409 });
    }

    const result = await db.artisanProfile.updateMany({
      where: { id, status: 'suspended' },
      data: { status: 'active', suspendedAt: null, suspensionReason: null },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'invalidTransition' }, { status: 409 });
    }

    const title = 'تمت إعادة تفعيل متجرك';
    const body = 'أصبح متجرك ظاهرًا من جديد. نتمنى لك التوفيق.';

    // Fire-and-forget: the DB row is authoritative, so a notification outage
    // must not fail the reinstatement.
    void createNotification({
      userId: store.userId,
      type: 'store_moderation',
      title,
      body,
      data: {
        i18n: {
          titleKey: 'storeReinstated',
          bodyKey: 'storeReinstatedBody',
          params: {},
        },
      },
    }).catch((e) => console.warn('[store-moderation] notification failed:', e));

    void sendPushNotification(store.userId, title, body, { type: 'store_reinstated' }).catch(
      () => undefined
    );

    return NextResponse.json({ ok: true, id, status: 'active' });
  } catch (e) {
    console.error('[api/admin/craft/artisans/[id]/reinstate]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}