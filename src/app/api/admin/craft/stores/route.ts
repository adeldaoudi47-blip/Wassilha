import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { adminArtisanRowSelect } from '@/lib/dto';
import { ARTISAN_STATUSES } from '@/lib/marketplace-moderation';

// GET /api/admin/craft/stores   (privileged admin only)
//
// Marketplace STORE oversight — every seller row, not just the pending
// applications that ../artisans shows, so an admin can find an already-approved
// store that needs suspending.
//
// `adminArtisanRowSelect` carries `suspendedAt` + `suspensionReason`, which is
// the whole point: an admin must see WHY a store went dark before reinstating
// it, and that reason is never exposed on any public route.
//
// The `user` relation is projected with `publicUserSelect`, so this admin-only
// response still cannot leak `passwordHash` / `email` / `phoneVerified`.
export async function GET(_req: NextRequest) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const stores = await db.artisanProfile.findMany({
      select: adminArtisanRowSelect,
      // Suspended first would be nicer, but `status` is a free-text column so
      // there is no portable enum ordering to lean on; newest-first is stable
      // and the UI filters client-side.
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return NextResponse.json({ stores, statuses: ARTISAN_STATUSES });
  } catch (e) {
    console.error('[api/admin/craft/stores]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}