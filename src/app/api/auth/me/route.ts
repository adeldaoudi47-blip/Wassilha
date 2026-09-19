import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ensureRealtime } from '@/lib/realtime-server';
import type { AuthUser, Role } from '@/lib/types';

// GET /api/auth/me — also boots the in-process realtime server as a side effect.
// For an authenticated driver, also returns the application status so the
// frontend can react to pending/rejected states.
export async function GET() {
  ensureRealtime();
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ user: null });
    }
    let driverApplicationStatus: string | null = null;
    if (user.role === 'driver') {
      const driver = await db.driver.findUnique({
        where: { userId: user.id },
        select: { applicationStatus: true },
      });
      driverApplicationStatus = driver?.applicationStatus ?? null;
    }
    return NextResponse.json({ user, driverApplicationStatus });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_AVATAR_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const MAX_NAME_LEN = 50;

// PATCH /api/auth/me — OPTIONAL profile completion for the logged-in user.
//
// A customer created via the OTP auto-create flow starts with an EMPTY name;
// this route is where they (and any driver/artisan) fill it in and set their
// avatar, at any time, from the "حسابي / Mon compte" tab.
//
// Body: multipart/form-data
//   name   (string, optional) — trimmed, max 50 chars, may be empty to clear
//   avatar (File,   optional) — image uploaded to Vercel Blob; the URL is
//                               stored on the user row. A client-supplied URL
//                               is NEVER accepted — only a real file upload,
//                               so the avatar is always a blob we control.
//
// Returns the fresh AuthUser so the client store can update in place.
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const form = await req.formData();
    const rawName = form.get('name');
    const file = form.get('avatar');

    const data: { name?: string; avatar?: string } = {};

    if (rawName !== null && rawName !== undefined) {
      if (typeof rawName !== 'string') {
        return NextResponse.json({ error: 'invalidName' }, { status: 400 });
      }
      const trimmed = rawName.trim();
      if (trimmed.length > MAX_NAME_LEN) {
        return NextResponse.json({ error: 'nameTooLong' }, { status: 400 });
      }
      data.name = trimmed;
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
      // Namespaced per user so one customer's avatars never collide with
      // another's (matches the craft upload convention).
      const key = `avatars/${session.id}/${crypto.randomUUID()}.${ext}`;
      const blob = await put(key, file, { access: 'public', addRandomSuffix: false });
      data.avatar = blob.url;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothingToUpdate' }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: session.id },
      data,
      select: { id: true, phone: true, name: true, role: true, avatar: true },
    });

    const authUser: AuthUser = {
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      role: updated.role as Role,
      avatar: updated.avatar,
    };

    return NextResponse.json({ user: authUser });
  } catch (e) {
    console.error('[WASSILHA ME PATCH ERROR]', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
