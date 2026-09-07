import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizeAlgerianPhone } from '@/lib/phone';

// POST /api/craft/artisan/apply
//
// HIRFA (P4): self-service artisan store application. Mirrors the driver
// self-registration workflow but for LOGGED-IN customers:
//   - Authentication: a live session is REQUIRED (the customer applies
//     from their profile screen - no phone-verification cookie needed).
//   - Role gate: only `customer` accounts may apply.
//   - The server FORCES status: "pending" - the client can never
//     influence the approval state (same trust model as apply-driver).
//   - Re-application: a previously REJECTED application may be re-submitted
//     (reset to pending, mirroring the driver re-apply flow). An active or
//     still-pending application returns 409.
const applySchema = z.object({
  displayName: z.string().trim().min(2, 'displayNameTooShort').max(60, 'displayNameTooLong'),
  bio: z.string().trim().max(500).optional().nullable(),
  // Optional contact number. Normalized server-side; invalid values are
  // rejected with 400 instead of being silently stored.
  phone: z.string().trim().optional().nullable(),
  // Optional workshop neighbourhood. The client sends the DeliveryArea
  // SLUG (local taxonomy in src/lib/delivery-data.ts); the server
  // resolves it to the DB row id.
  areaSlug: z.string().trim().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (session.role !== 'customer') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalidInput', issues: parsed.error.issues }, { status: 400 });
    }
    const displayName = parsed.data.displayName;
    const bio = parsed.data.bio ?? null;
    const rawPhone = parsed.data.phone ?? null;
    const areaSlug = parsed.data.areaSlug ?? null;

    const phoneCanonical = rawPhone ? normalizeAlgerianPhone(rawPhone) : null;
    if (rawPhone && !phoneCanonical) {
      return NextResponse.json({ error: 'invalidPhone' }, { status: 400 });
    }

    let areaId: string | null = null;
    if (areaSlug) {
      const area = await db.deliveryArea.findUnique({ where: { slug: areaSlug }, select: { id: true, isActive: true } });
      if (!area || !area.isActive) {
        return NextResponse.json({ error: 'invalidArea' }, { status: 400 });
      }
      areaId = area.id;
    }

    const existing = await db.artisanProfile.findUnique({ where: { userId: session.id } });
    if (existing && existing.status !== 'rejected') {
      // Pending (awaiting review) or already-active store: no second application.
      return NextResponse.json({ error: 'alreadyApplied', status: existing.status }, { status: 409 });
    }

    if (existing) {
      // Rejected application: allow re-submission by resetting to pending
      // (mirrors the driver re-apply flow). No data is deleted.
      const updated = await db.artisanProfile.update({
        where: { id: existing.id },
        data: {
          displayName,
          bioAr: bio,
          phone: phoneCanonical,
          areaId,
          status: 'pending',
          appliedAt: new Date(),
          reviewedAt: null,
        },
      });
      console.log('[Craft Apply] Re-submitted rejected artisan application:', updated.id);
      return NextResponse.json({ ok: true, status: 'pending', reapplied: true }, { status: 200 });
    }

    const created = await db.artisanProfile.create({
      data: {
        userId: session.id,
        displayName,
        bioAr: bio,
        phone: phoneCanonical,
        areaId,
        // SECURITY: forced server-side - the client cannot influence this.
        status: 'pending',
        appliedAt: new Date(),
      },
    });
      console.log('[Craft Apply] Created artisan application:', created.id);
    return NextResponse.json({ ok: true, status: 'pending' }, { status: 201 });
  } catch (e) {
    console.error('[Craft Apply] Error:', e);
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}
