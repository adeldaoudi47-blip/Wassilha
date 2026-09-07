import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/craft/categories
// Public: active HIRFA categories ordered by sortOrder. Anonymous
// browsing is allowed (the global proxy rate-limit still applies).
export async function GET() {
  try {
    const categories = await db.craftCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameAr: true, nameFr: true, slug: true, sortOrder: true },
    });
    return NextResponse.json(categories);
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
