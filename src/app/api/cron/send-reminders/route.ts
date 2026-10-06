import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

// NOTIFICATIONS (Phase 11) — service reminder cron.
//
// Finds customers who have NOT placed any delivery Order (taxi or cargo)
// in the last 7 days AND have not been reminded inside that same window,
// then drops a gentle "we are here for you" reminder into their notification
// center. The window-based exclusion keeps the nagging to at most one
// reminder per user per 7 days and makes the bounded batch ROTATE: rows
// reminded today leave tomorrow's candidate set, so a base larger than
// REMINDER_BATCH is covered over successive days instead of re-picking the
// same slice forever.
//
// SECURITY: no user session is involved. Exactly like
// /api/cron/dispatch-scheduled, the only thing that can call this is Vercel's
// scheduler, authenticated with the shared CRON_SECRET bearer token and a
// timing-safe compare. With no secret configured the route refuses to run, so
// local `next dev` is safe by default.
export const dynamic = 'force-dynamic';

const REMINDER_WINDOW_DAYS = 7;
// Bounded batch so a large inactive base can never exceed the serverless
// function timeout in one invocation. 500 rows of a single indexed insert is
// comfortably fast; the next day's tick catches the rest.
const REMINDER_BATCH = 500;

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If the secret is not configured, refuse to run rather than open an
  // unauthenticated mass-notification endpoint.
  if (!secret) return false;

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Vercel Cron issues GET requests (same as /api/cron/dispatch-scheduled);
// POST is accepted as well so the route can be exercised manually with
// `curl -X POST` during development. Both share the identical gated handler.
export async function GET(req: NextRequest) {
  return handleReminderCron(req);
}

export async function POST(req: NextRequest) {
  return handleReminderCron(req);
}

async function handleReminderCron(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Two NOT EXISTS clauses (no N+1, no notification table scan):
    //   1. no delivery Order since the window start  → genuinely inactive;
    //   2. no service_reminder since that same start → already heard from us.
    // Clause 2 is what makes the batch rotate (see header) and caps the
    // cadence at one reminder per user per 7 days. Customers only:
    // drivers/artisans have their own surfaces and must never receive the
    // customer-facing reminder copy.
    const inactive = await db.user.findMany({
      where: {
        role: 'customer',
        orders: { none: { createdAt: { gte: since } } },
        notifications: {
          none: { type: 'service_reminder', createdAt: { gte: since } },
        },
      },
      select: { id: true },
      // Deterministic slice: oldest accounts first, stable across runs.
      orderBy: { createdAt: 'asc' },
      take: REMINDER_BATCH,
    });
    if (inactive.length === 0) {
      return NextResponse.json({ reminded: 0, candidates: 0 });
    }

    const title = 'نحن هنا لخدمتك';
    const body = 'هل تحتاج إلى توصيل بضائع أو سيارة أجرة اليوم؟ وصّلها دائماً في خدمتك!';

    let reminded = 0;
    for (const user of inactive) {
      try {
        await createNotification({
          userId: user.id,
          type: 'service_reminder',
          title,
          body,
          // No realtime trigger: a daily reminder is never urgent, and N
          // Pusher calls for a mass mailing would only burn the connection
          // budget. The row is delivered when the app opens.
          realtime: false,
          data: {
            i18n: {
              titleKey: 'serviceReminderTitle',
              bodyKey: 'serviceReminderBody',
            },
          },
        });
        reminded += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cron/send-reminders] row failed for', user.id, e);
      }
    }

    // eslint-disable-next-line no-console
    console.info(
      `[cron/send-reminders] candidates=${inactive.length} reminded=${reminded}`,
    );

    return NextResponse.json({ reminded, candidates: inactive.length });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron/send-reminders] failed:', e);
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 },
    );
  }
}
