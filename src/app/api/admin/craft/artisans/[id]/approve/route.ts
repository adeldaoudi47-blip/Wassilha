import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { sendPushNotification } from '@/lib/firebase-admin';
import { createNotification } from '@/lib/notifications';
import { allocateStoreSlug } from '@/lib/slug-allocate';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { id } = await params;
    const row = await db.artisanProfile.findUnique({ where: { id }, select: { userId: true, status: true, slug: true, displayName: true } });
    if (!row) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (row.status !== 'pending') return NextResponse.json({ error: 'notPending' }, { status: 409 });

    // HIRFA Phase 2B: a store becomes PUBLIC the moment it is approved, so it
    // MUST carry a stable slug at this exact point. Normally the slug is
    // allocated at apply time; this guarantees it even for rows created by
    // another path (defense in depth). Idempotent: an existing slug is never
    // regenerated, so no live URL ever changes.
    const slug = row.slug && row.slug.length >= 2
      ? row.slug
      : await allocateStoreSlug(row.displayName, id);

    // Transaction: update artisan profile status AND user role atomically
    await db.$transaction([
      db.artisanProfile.update({ where: { id }, data: { status: 'active', reviewedAt: new Date(), slug } }),
      db.user.update({ where: { id: row.userId }, data: { role: 'artisan', accountStatus: 'active' } }),
    ]);

    void sendPushNotification(row.userId, 'حِرفة', 'تمت الموافقة على متجرك في حِرفة! يمكنك الآن إضافة منتجاتك.', { type: 'artisan_approved' }).catch(() => undefined);
    // In-app notification center row: same moment, durable record — the
    // artisan reads it from their bell even if the push never landed.
    void createNotification({
      userId: row.userId,
      type: 'artisan_application',
      title: 'تمت الموافقة على متجرك',
      body: 'يمكنك الآن إضافة منتجاتك.',
      data: {
        artisanId: id,
        i18n: { titleKey: 'storeApproved', bodyKey: 'storeApprovedBody' },
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, id, status: 'active' });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
