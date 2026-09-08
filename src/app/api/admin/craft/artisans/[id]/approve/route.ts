import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { sendPushNotification } from '@/lib/firebase-admin';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { id } = await params;
    const row = await db.artisanProfile.findUnique({ where: { id }, select: { userId: true, status: true } });
    if (!row) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    if (row.status !== 'pending') return NextResponse.json({ error: 'notPending' }, { status: 409 });

    // Transaction: update artisan profile status AND user role atomically
    await db.$transaction([
      db.artisanProfile.update({ where: { id }, data: { status: 'active', reviewedAt: new Date() } }),
      db.user.update({ where: { id: row.userId }, data: { role: 'artisan', accountStatus: 'active' } }),
    ]);

    void sendPushNotification(row.userId, 'حِرفة', 'تمت الموافقة على متجرك في حِرفة! يمكنك الآن إضافة منتجاتك.', { type: 'artisan_approved' }).catch(() => undefined);
    return NextResponse.json({ ok: true, id, status: 'active' });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
