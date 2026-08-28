import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePrivilegedAdmin } from '@/lib/auth';
import { CARGO_MULTIPLIERS_DEFAULT } from '@/lib/wassilha-data';
import type { CargoKey, PricingConfig } from '@/lib/types';

function parsePricing(row: {
  id: string;
  basePrice: number;
  perKm: number;
  multipliers: string;
}): PricingConfig {
  let multipliers: Record<CargoKey, number>;
  try {
    multipliers = JSON.parse(row.multipliers) as Record<CargoKey, number>;
  } catch {
    multipliers = { ...CARGO_MULTIPLIERS_DEFAULT };
  }
  return {
    id: row.id,
    basePrice: row.basePrice,
    perKm: row.perKm,
    multipliers,
  };
}

async function getPricingRow() {
  let row = await db.pricing.findUnique({ where: { id: 'default' } });
  if (!row) {
    row = await db.pricing.create({
      data: {
        id: 'default',
        basePrice: 150,
        perKm: 60,
        multipliers: JSON.stringify(CARGO_MULTIPLIERS_DEFAULT),
      },
    });
  }
  return row;
}

// GET /api/pricing
export async function GET() {
  try {
    const row = await getPricingRow();
    return NextResponse.json(parsePricing(row));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}

// PUT /api/pricing  { basePrice?, perKm?, multipliers? }  (admin only)
export async function PUT(req: NextRequest) {
  try {
    // SECURITY: only the privileged admin phone (hard-coded) can write pricing.
    const gate = await requirePrivilegedAdmin();
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    const body = await req.json();
    const data: {
      basePrice?: number;
      perKm?: number;
      multipliers?: string;
    } = {};

    if (typeof body.basePrice === 'number' && Number.isFinite(body.basePrice)) {
      data.basePrice = Math.round(body.basePrice);
    }
    if (typeof body.perKm === 'number' && Number.isFinite(body.perKm)) {
      data.perKm = Math.round(body.perKm);
    }
    if (body.multipliers && typeof body.multipliers === 'object') {
      // Merge with defaults to ensure all cargo keys are present.
      const merged = { ...CARGO_MULTIPLIERS_DEFAULT };
      for (const k of Object.keys(CARGO_MULTIPLIERS_DEFAULT) as CargoKey[]) {
        const v = (body.multipliers as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          merged[k] = v;
        }
      }
      data.multipliers = JSON.stringify(merged);
    }

    const existing = await getPricingRow();
    const row = await db.pricing.update({
      where: { id: existing.id },
      data,
    });
    return NextResponse.json(parsePricing(row));
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
