import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  isReportReason,
  isReportTargetType,
  reportTargetIsPublic,
} from '@/lib/marketplace-moderation';

// POST /api/craft/reports   { targetType, targetId, reason, description? }
//
// ANY AUTHENTICATED USER may flag a public product or store.
//
// A REPORT RECORDS A COMPLAINT AND NOTHING ELSE.
//
// The single most important property of this endpoint is what it does NOT do:
// it never touches `CraftProduct.moderationStatus` or `ArtisanProfile.status`.
// A report is evidence for a human to look at, not a verdict. If filing a
// report auto-hid a listing, then anyone could weaponise this route to censor a
// competitor's storefront with two taps. All consequences live in the admin
// routes under /api/admin/craft/*.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    // Keyed on the server-derived session id, which cannot be spoofed, so one
    // account cannot flood the queue (a reporter mashing this would otherwise
    // bury every other report).
    const rl = await rateLimit(`marketplace-report:${session.id}`, 10, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'tooManyRequests', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      targetType?: unknown;
      targetId?: unknown;
      reason?: unknown;
      description?: unknown;
    } | null;

    const targetType = body?.targetType;
    const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
    const reason = body?.reason;

    if (!isReportTargetType(targetType) || !targetId || !isReportReason(reason)) {
      return NextResponse.json(
        { error: 'invalidInput', reasons: REPORT_REASONS, targetTypes: REPORT_TARGET_TYPES },
        { status: 400 }
      );
    }

    const description =
      typeof body?.description === 'string' ? body.description.trim().slice(0, 1000) : null;

    // Resolve the target and prove it is actually PUBLIC.
    // A report against something not publicly visible is refused with the same
    // 404 as a report against something that does not exist: otherwise the
    // error code would let anyone probe for hidden/pending listings and stores.
    let productId: string | null = null;
    let artisanId: string | null = null;

    if (targetType === 'product') {
      const product = await db.craftProduct.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          artisanId: true,
          moderationStatus: true,
          artisan: { select: { id: true, userId: true, status: true } },
        },
      });
      const visible =
        product != null &&
        reportTargetIsPublic({
          targetType: 'product',
          productStatus: product.moderationStatus,
          productArtisanStatus: product.artisan.status,
        });
      if (!product || !visible) {
        return NextResponse.json({ error: 'notFound' }, { status: 404 });
      }
      if (product.artisan.userId === session.id) {
        return NextResponse.json({ error: 'ownListing' }, { status: 400 });
      }
      productId = product.id;
      artisanId = product.artisanId;
    } else {
      const store = await db.artisanProfile.findUnique({
        where: { id: targetId },
        select: { id: true, userId: true, status: true },
      });
      const visible =
        store != null &&
        reportTargetIsPublic({ targetType: 'store', artisanStatus: store.status });
      if (!store || !visible) {
        return NextResponse.json({ error: 'notFound' }, { status: 404 });
      }
      if (store.userId === session.id) {
        return NextResponse.json({ error: 'ownListing' }, { status: 400 });
      }
      artisanId = store.id;
    }

    // One open report per reporter per target. Re-reporting is allowed only
    // after the previous report was closed, so a single grudge cannot occupy
    // the queue with duplicates.
    const duplicate = await db.marketplaceReport.findFirst({
      where: {
        reporterId: session.id,
        status: { in: ['open', 'reviewed'] },
        ...(targetType === 'product' ? { productId } : { artisanId }),
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: 'alreadyReported' }, { status: 409 });
    }

    const report = await db.marketplaceReport.create({
      data: {
        reporterId: session.id, // server-derived, never from the body
        targetType,
        productId,
        artisanId,
        reason,
        description,
        // Creation state only; only an admin may move it from here.
        status: 'open',
      },
      select: { id: true, status: true, createdAt: true },
    });

    // The response carries nothing about the target: reporting must not become
    // a read API for listing internals.
    return NextResponse.json({ ok: true, id: report.id, status: report.status }, { status: 201 });
  } catch (e) {
    console.error('[api/craft/reports]', e);
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}