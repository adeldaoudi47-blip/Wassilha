import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireActiveArtisan } from '@/lib/auth';
import {
  buildImageKey,
  validateImageUpload,
} from '@/lib/image-upload';
import { rateLimit, clientIp } from '@/lib/rate-limit';

// POST /api/craft/upload
// Artisan-only. Multipart form upload -> Vercel Blob (public access) ->
// returns the resulting URL for use in the product images array.
//
// PHASE 8: the body is now validated by the SHARED validator used by
// /api/uploads/order-image (lib/image-upload.ts). Previously this route checked
// only the file EXTENSION, so a seller could store an SVG (or any script-like
// file) and have it served from the public CDN host — a stored-XSS vector that
// Phase 5 had already closed for the order-image route but not for this one.
export async function POST(req: NextRequest) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  // PHASE 8: an upload writes to the Blob store on every call, so cap per IP.
  const ipCheck = await rateLimit(`craftupload:${clientIp(req)}`, 30, 60 * 60 * 1000);
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
    const key = buildImageKey('craft/products', crypto.randomUUID(), result.ext);
    const blob = await put(key, file as File, {
      access: 'public',
      // The key already carries a UUID, so Vercel's suffix is unnecessary; it
      // stays off so the stored URL is deterministic for this one upload.
      addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error('[CRAFT UPLOAD] Error:', e);
    // SECURITY: do not echo the exception detail to the client.
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  }
}
