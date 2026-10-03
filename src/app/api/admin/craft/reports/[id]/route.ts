import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { canResolveReport, isReportResolutionStatus } from '@/lib/marketplace-moderation';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/craft/reports/:id   { status: 'reviewed' | 'resolved' | 'dismissed' }
// Admin-only (privileged admin gate).
//
// CLOSING A REPORT IS NOT A PUNISHMENT.
//
// Like POST /api/craft/reports, this route changes ONLY `MarketplaceReport`. It
// never suspends a product or a store: `resolved` means "a human looked at this
// and the complaint was upheld or handled", and it does NOT imply the target
// was restricted. Acting on the target is a separate, explicit call to the
// product/store moderation routes, so the audit trail shows what was decided
// about the report AND what was decided about the listing separately — instead
// of one click silently doing both.
//
// TERMINAL STATES: `resolved` and `dismissed` are final. A closed report cannot
// be re-opened, because "who decided what, and when" is precisely the property
// this record exists to preserve. A dispute can always be filed as a NEW report.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
    const status = body?.status;

    if (!isReportResolutionStatus(status)) {
      return NextResponse.json({ error: 'invalidStatus' }, { status: 400 });
    }

    const report = await db.marketplaceReport.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!report) return NextResponse.json({ error: 'notFound' }, { status: 404 });

    const from = report.status;
    if (!canResolveReport(from, status)) {
      // e.g. trying to re-open (only 'reviewed'/'resolved'/'dismissed' are
      // reachable targets) or closing an already-closed report.
      return NextResponse.json({ error: 'invalidTransition', from, status }, { status: 409 });
    }

    // 'reviewed' is a non-terminal "an admin has looked at this" marker, so it
    // deliberately does NOT stamp resolvedAt/resolvedById — those record the
    // actual closure.
    const terminal = status === 'resolved' || status === 'dismissed';

    // Compare-and-set on the status we just read, so two admins closing the same
    // report cannot both succeed.
    const result = await db.marketplaceReport.updateMany({
      where: { id, status: from },
      data: {
        status,
        ...(terminal
          ? { resolvedAt: new Date(), resolvedById: gate.session.id }
          : {}),
      },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'invalidTransition' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, id, from, status });
  } catch (e) {
    console.error('[api/admin/craft/reports/[id]]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}