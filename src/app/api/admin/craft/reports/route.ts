import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { adminMarketplaceReportSelect } from '@/lib/dto';
import {
  REPORT_REASONS,
  REPORT_STATUSES,
  isReportStatus,
} from '@/lib/marketplace-moderation';

// GET /api/admin/craft/reports?status=open   (privileged admin only)
//
// The marketplace report QUEUE — the admin's view of what customers flagged.
//
// This route is READ-ONLY and reports NOTHING to the reported party: filing a
// report must not expose the reporter to the seller, and the queue must not
// mutate a listing (resolving a report is a separate, explicit PATCH).
//
// `adminMarketplaceReportSelect` embeds the target (product or store) *and* its
// current status, so an admin can triage in one screen: a product already
// suspended, or a store already suspended, should not be actioned twice.
export async function GET(req: NextRequest) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const raw = req.nextUrl.searchParams.get('status');
    // An unrecognised value is ignored rather than passed into the query.
    const status = isReportStatus(raw) ? raw : null;

    const reports = await db.marketplaceReport.findMany({
      where: status ? { status } : {},
      select: adminMarketplaceReportSelect,
      // Newest first: the queue is worked top-down.
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json({ reports, statuses: REPORT_STATUSES, reasons: REPORT_REASONS });
  } catch (e) {
    console.error('[api/admin/craft/reports]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}