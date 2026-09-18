import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/craft/areas
// Public: active HIRFA delivery areas (workshop neighbourhoods), ordered by
// sortOrder. Used by the search page's dynamic Area filter. Anonymous
// browsing is allowed (the global proxy rate-limit still applies).
export async function GET() {
  try {
    const areas = await db.deliveryArea.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameAr: true, nameFr: true, slug: true, sortOrder: true },
    });
    return NextResponse.json(areas);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
