import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '@/lib/auth';
import {
  buildImageKey,
  validateImageUpload,
} from '@/lib/image-upload';
import { rateLimit, clientIp } from '@/lib/rate-limit';

// POST /api/uploads/order-image
// CARGO DEDICATED FLOW (Phase 4): any logged-in user may attach ONE photo
// to a request (customers photograph the goods; the file is later stored as
// `Order.cargoImageUrl`). Unlike the craft uploader this is not artisan-
// gated — the customer app is the caller — but the upload is namespaced
// under the caller's user id so blobs are attributable, images only, size
// capped, and the URL returned here is only ever accepted back by
// POST /api/orders through the host allow-list in lib/offer-policy.ts.
//
// PHASE 8: validation moved into the shared lib/image-upload.ts so this route
// and /api/craft/upload enforce identical rules and cannot drift apart again.
// Phase 5 added the MIME allow-list here only; the craft uploader kept
// extension-only checking until this phase.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // PHASE 8: cap upload volume per IP — every call writes to Blob storage.
  const ipCheck = await rateLimit(`orderimage:${clientIp(req)}`, 30, 60 * 60 * 1000);
  if (!ipCheck.ok) {
    return NextResponse.json(
      { error: 'tooManyRequests', retryAfterSec: ipCheck.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    const result = validateImageUpload(file);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const key = buildImageKey('orders', session.id, result.ext);
    const blob = await put(key, file as File, {
      access: 'public',
      addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error('[UPLOAD order-image] Error:', e);
    // SECURITY: do not echo the exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}