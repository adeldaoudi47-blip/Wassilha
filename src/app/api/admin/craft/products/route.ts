import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { sellerCraftProductSelect } from '@/lib/dto';
import {
  PRODUCT_MODERATION_STATUSES,
  isProductModerationStatus,
} from '@/lib/marketplace-moderation';

// GET /api/admin/craft/products  (privileged admin only)
//
// The marketplace PRODUCT MODERATION queue. Returns the seller-owned projection
// (so the admin can read the moderation verdict) widened with the store status
// — an admin deciding on a product must be able to see that the store itself is
// suspended, otherwise they would approve a listing that cannot appear anyway.
//
// AUTHORIZATION: requirePrivilegedAdmin() = valid session AND role 'admin' AND
// the hard-coded privileged phone. A seller hitting this route gets 403; the UI
// never being shown the link is not the security.
//
// PII: `publicCraftProductSelect` + the moderation columns only. No artisan
// phone/userId is returned here beyond the store's public display name.
export async function GET(req: NextRequest) {
  const gate = await requirePrivilegedAdmin();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    // Optional ?status= filter. Validated against the shared union — an
    // unrecognised value is ignored (not interpolated into the query).
    const raw = req.nextUrl.searchParams.get('status');
    const status = isProductModerationStatus(raw) ? raw : null;

    const products = await db.craftProduct.findMany({
      where: status ? { moderationStatus: status } : {},
      select: {
        ...sellerCraftProductSelect,
        artisan: { select: { id: true, displayName: true, slug: true, status: true } },
      },
      // Newest first: a fresh submission is what needs attention.
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json({ products, statuses: PRODUCT_MODERATION_STATUSES });
  } catch (e) {
    console.error('[api/admin/craft/products]', e);
    // SECURITY: no raw exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}