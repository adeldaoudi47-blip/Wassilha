// Fixed-window rate limiting backed by the RateLimit table so buckets survive
// across server instances (works on Vercel serverless too).
import { db } from './db';

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/**
 * Allows at most `limit` hits per `windowMs` for `key`.
 * Fails OPEN on infrastructure errors so a DB hiccup can never fully break
 * the OTP flow — the per-phone cooldowns still apply independently.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = new Date();
  try {
    const existing = await db.rateLimit.findUnique({ where: { key } });

    if (!existing || existing.windowStart.getTime() <= now.getTime() - windowMs) {
      await db.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now },
        update: { count: 1, windowStart: now },
      });
      return { ok: true, retryAfterSec: 0 };
    }

    if (existing.count >= limit) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((existing.windowStart.getTime() + windowMs - now.getTime()) / 1000)
      );
      return { ok: false, retryAfterSec };
    }

    await db.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return { ok: true, retryAfterSec: 0 };
  } catch {
    return { ok: true, retryAfterSec: 0 };
  }
}

/** Best-effort client IP behind proxies (Caddy/Vercel populate these headers). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}