import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';
import type { MyStoreInfo } from '@/lib/types';

// GET /api/craft/artisan/me
// Artisan-only: the caller's own public store info (slug + displayName) so
// the dashboard can show the stable public store URL for sharing.
// Returns only public-safe fields (no phone / coords / userId).
export async function GET() {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const store = await db.artisanProfile.findUnique({
      where: { id: gate.artisanId },
      select: { id: true, slug: true, displayName: true, status: true, avatarUrl: true },
    });
    if (!store) return NextResponse.json({ error: 'notFound' }, { status: 404 });
    return NextResponse.json(store);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}

const MAX_DISPLAY_NAME_LEN = 80;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_AVATAR_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// PATCH /api/craft/artisan/me — OPTIONAL store profile edit for the
// logged-in (ACTIVE) artisan.
//
// Body: multipart/form-data
//   displayName (string, optional) — trimmed, 2..80 chars
//   avatar       (File,   optional) — image uploaded to Vercel Blob; the URL
//                                      is stored on the ArtisanProfile row. A
//                                      client-supplied URL is NEVER accepted —
//                                      only a real file upload — so the store
//                                      avatar is always a blob we control.
//
// The store SLUG is deliberately NEVER touched here: it is generated once (at
// apply/backfill time) so the public store URL /craft/<slug> stays stable for
// life even when the display name changes.
//
// Returns the fresh MyStoreInfo so the dashboard updates in place.
export async function PATCH(req: NextRequest) {
  const gate = await requireActiveArtisan();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const form = await req.formData();
    const rawName = form.get('displayName');
    const file = form.get('avatar');

    const data: { displayName?: string; avatarUrl?: string } = {};

    if (rawName !== null && rawName !== undefined) {
      if (typeof rawName !== 'string') {
        return NextResponse.json({ error: 'invalidName' }, { status: 400 });
      }
      const trimmed = rawName.trim();
      if (trimmed.length < 2) {
        return NextResponse.json({ error: 'nameTooShort' }, { status: 400 });
      }
      if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
        return NextResponse.json({ error: 'nameTooLong' }, { status: 400 });
      }
      data.displayName = trimmed;
    }

    if (file !== null && file !== undefined) {
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'invalidAvatar' }, { status: 400 });
      }
      if (file.size > MAX_AVATAR_BYTES) {
        return NextResponse.json({ error: 'fileTooLarge' }, { status: 400 });
      }
      const ext = (file.name.split('.').pop() || 'jpg')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (!ALLOWED_AVATAR_EXT.has(ext)) {
        return NextResponse.json({ error: 'unsupportedType' }, { status: 400 });
      }
      // Namespaced per store (mirrors the avatars/<userId>/ convention of
      // /api/auth/me) so one store's avatar never collides with another's.
      const key = `craft/stores/${gate.artisanId}/${crypto.randomUUID()}.${ext}`;
      const blob = await put(key, file, { access: 'public', addRandomSuffix: false });
      data.avatarUrl = blob.url;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothingToUpdate' }, { status: 400 });
    }

    const updated = await db.artisanProfile.update({
      where: { id: gate.artisanId },
      data,
      select: { id: true, slug: true, displayName: true, status: true, avatarUrl: true },
    });

    const store: MyStoreInfo = {
      id: updated.id,
      slug: updated.slug,
      displayName: updated.displayName,
      status: updated.status,
      avatarUrl: updated.avatarUrl,
    };

    return NextResponse.json(store);
  } catch (e) {
    console.error('[api/craft/artisan/me PATCH]', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
