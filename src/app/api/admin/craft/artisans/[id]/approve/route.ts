import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { sendPushNotification } from '@/lib/firebase-admin';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/artisans/:id/approve
// Admin-only (privileged admin gate). Flips a PENDING artisan application
// to active. Race-safe: updateMany only matches rows still in pending, so
// a double-click or concurrent review cannot double-approve.
export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  try {
    const { id } = await params;
    const profile = await db.artisanProfile.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, displayName: true },
    });
    if (!profile) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    const result = await db.artisanProfile.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'active', reviewedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'notPending' }, { status: 409 });
    }
    // Fire-and-forget push so the artisan learns the good news. Never
    // blocks or fails the response.
    void sendPushNotification(
      profile.userId,
      'حِرفة',
      'تمت الموافقة على متجرك في حِرفة! يمكنك الآن إضافة منتجاتك.',
      { type: 'artisan_approved' }
    ).catch(() => undefined);
    return NextResponse.json({ ok: true, id, status: 'active' });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
