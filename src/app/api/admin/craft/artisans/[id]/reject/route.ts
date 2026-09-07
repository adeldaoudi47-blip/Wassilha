import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/artisans/:id/reject
// Admin-only (privileged admin gate). Flips a PENDING artisan application
// to rejected. The profile row is KEPT (no deletion) so the applicant can
// re-submit later via the same apply endpoint.
export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  try {
    const { id } = await params;
    const result = await db.artisanProfile.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', reviewedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'notPending' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id, status: 'rejected' });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
