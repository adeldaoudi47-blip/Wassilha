import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireActiveArtisan } from '@/lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// POST /api/craft/upload
// Artisan-only. Multipart form upload -> Vercel Blob (public access) ->
// returns the resulting URL for use in the product images array. The blob
// key is namespaced under craft/<uuid>.<ext>.
export async function POST(req: NextRequest) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missingFile' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'fileTooLarge' }, { status: 400 });
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: 'unsupportedType' }, { status: 400 });
    }
    const key = `craft/products/${crypto.randomUUID()}.${ext}`;
    const blob = await put(key, file, { access: 'public', addRandomSuffix: false });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    // Log the error for debugging purposes
    console.error('[CRAFT UPLOAD] Error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
