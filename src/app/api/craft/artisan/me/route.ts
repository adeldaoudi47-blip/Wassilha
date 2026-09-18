import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveArtisan } from '@/lib/auth';

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
