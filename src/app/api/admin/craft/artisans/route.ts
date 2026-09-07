import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { publicUserSelect } from '@/lib/dto';

// GET /api/admin/craft/artisans
// Admin-only: HIRFA artisan applications awaiting review (pending) plus
// rejected ones (so the reviewer keeps the history in context).
// PII note: the admin IS allowed to see the applicant name + phone
// (publicUserSelect) - same policy as the driver applications queue.
export async function GET() {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  try {
    const artisans = await db.artisanProfile.findMany({
      where: { status: { in: ['pending', 'rejected'] } },
      orderBy: [{ status: 'asc' }, { appliedAt: 'desc' }],
      select: {
        id: true,
        userId: true,
        displayName: true,
        bioAr: true,
        bioFr: true,
        phone: true,
        status: true,
        appliedAt: true,
        reviewedAt: true,
        createdAt: true,
        area: { select: { nameAr: true, nameFr: true } },
        user: { select: publicUserSelect },
      },
    });
    return NextResponse.json(artisans);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
