import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { sendPushNotification } from '@/lib/firebase-admin';
import { canModerateStore } from '@/lib/marketplace-moderation';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/artisans/:id/suspend   { reason: string }
// Admin-only (privileged admin gate).
//
// SUSPENDING A STORE = setting ArtisanProfile.status to "suspended".
//
// This is deliberately a STATE and not a parallel boolean flag: the repo already
// gates every seller write on `requireActiveArtisan()` (which requires
// status === 'active') and every public storefront query on
// `status: 'active'`. Flipping the one status therefore switches off seller
// writes AND public visibility with no second check that a future route could
// forget to add.
//
// A suspended store keeps its row and its products — nothing is deleted, so
// reinstating restores it exactly as it was.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

    // The seller must be told WHY — an unexplained dead storefront looks
    // identical to a bug and cannot be appealed against.
    if (reason.length < 2) {
      return NextResponse.json({ error: 'reasonRequired' }, { status: 400 });
    }

    const store = await db.artisanProfile.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true },
    });
    if (!store) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    // Only an ACTIVE store can be suspended: a pending/rejected store is not
    // public to begin with, so "suspending" it would be a meaningless state
    // change that also muddies the application queue's meaning.
    if (!canModerateStore(store.status, 'suspend')) {
      return NextResponse.json({ error: 'invalidTransition', from: store.status }, { status: 409 });
    }

    const result = await db.artisanProfile.updateMany({
      where: { id, status: 'active' },
      data: { status: 'suspended', suspendedAt: new Date(), suspensionReason: reason },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'invalidTransition' }, { status: 409 });
    }

    notifyStoreSuspension(store.userId, 'suspended', reason);

    return NextResponse.json({ ok: true, id, status: 'suspended' });
  } catch (e) {
    console.error('[api/admin/craft/artisans/[id]/suspend]', e);
    // SECURITY: no raw exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}

function notifyStoreSuspension(userId: string, outcome: 'suspended' | 'reinstated', reason: string) {
  const suspended = outcome === 'suspended';
  const title = suspended ? 'تم إيقاف متجرك' : 'تمت إعادة تفعيل متجرك';
  const body = suspended
    ? `سبب الإيقاف: ${reason}`
    : 'أصبح متجرك ظاهرًا من جديد. نتمنى لك التوفيق.';

  void createNotification({
    userId,
    type: 'store_moderation',
    title,
    body,
    data: {
      i18n: {
        titleKey: suspended ? 'storeSuspended' : 'storeReinstated',
        bodyKey: suspended ? 'storeSuspendedBody' : 'storeReinstatedBody',
        params: { reason },
      },
    },
  }).catch((e) => console.warn('[store-moderation] notification failed:', e));

  void sendPushNotification(userId, title, body, {
    type: `store_${outcome}`,
  }).catch(() => undefined);
}