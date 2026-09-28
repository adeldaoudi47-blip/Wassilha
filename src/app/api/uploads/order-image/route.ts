import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '@/lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
// PHASE 5: the extension check keeps the blob KEY tidy, but it is not a
// content check — `payload.svg` renamed to `payload.jpg` would sail through
// and then be served from the public CDN host, which is a stored-XSS vector.
// Requiring the browser-reported MIME type to be one of the three raster
// formats closes it; `image/svg+xml` is deliberately absent from the list.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// POST /api/uploads/order-image
// CARGO DEDICATED FLOW (Phase 4): any logged-in user may attach ONE photo
// to a request (customers photograph the goods; the file is later stored as
// `Order.cargoImageUrl`). Unlike the craft uploader this is not artisan-
// gated — the customer app is the caller — but the upload is namespaced
// under the caller's user id so blobs are attributable, images only, size
// capped, and the URL returned here is only ever accepted back by
// POST /api/orders through the host allow-list in lib/offer-policy.ts.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missingFile' }, { status: 400 });
    }
    if (file.size === 0) {
      // PHASE 5: an empty part is a broken client, not a photo. Reject it
      // before it becomes a zero-byte blob that no card can render.
      return NextResponse.json({ error: 'emptyFile' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'fileTooLarge' }, { status: 400 });
    }
    // PHASE 5: MIME type AND extension must both agree on a supported raster
    // image. Either check alone is defeatable (rename / hand-built request).
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'unsupportedType' }, { status: 400 });
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: 'unsupportedType' }, { status: 400 });
    }
    const key = `orders/${session.id}/${crypto.randomUUID()}.${ext}`;
    const blob = await put(key, file, { access: 'public', addRandomSuffix: false });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    // Log the error for debugging purposes
    console.error('[UPLOAD order-image] Error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}