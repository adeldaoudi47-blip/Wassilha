import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/reject  (driver only)
// For simplicity, rejection is a no-op — the order stays "searching"
// and remains available to other drivers.
export async function POST(_req: NextRequest, _ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'driver') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
