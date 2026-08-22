import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/orders/:id
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const order = await db.order.findUnique({
      where: { id },
      include: { customer: true, driver: true },
    });
    if (!order) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
