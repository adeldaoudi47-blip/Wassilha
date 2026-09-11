import { NextRequest, NextResponse } from 'next/server';

// -----------------------------------------------------------------------------
// Global API rate limiter (OWASP — API4:2023 Unrestricted Resource Consumption)
//
// Runs in the Next.js Edge runtime as a middleware. Applies a coarse
// per-IP bucket to every /api/* route *except* the OTP / auth flows that
// already enforce their own stricter per-phone and per-IP limits inside
// the route handler. The goal here is to absorb bulk abuse and bots at
// the edge before the route handler is even reached.
//
// Storage strategy: in-memory Map. The Edge runtime is single-tenant per
// region/instance, and this is only a coarse first-line filter — the
// fine-grained per-IP and per-phone limits still use the DB-backed
// `rateLimit` helper in src/lib/rate-limit.ts inside each route. So a
// hot-IP that bypasses the middleware still hits the DB limit eventually.
// -----------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const LIMIT = 60;

// Endpoints that already enforce a per-phone / per-IP rate limit inside
// the route. We exempt them here to avoid double-counting (and to avoid
// rejecting legit "send me an OTP" calls if the user is also navigating
// the rest of the app).
const EXEMPT_PREFIXES = [
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/forgot-password',
  '/api/auth/apply-driver',
  // WhatsApp Cloud API webhook (Meta). Facebook's crawler calls GET with
  // hub.* params from Meta's own IPs and POSTs inbound messages in bursts;
  // it has no session cookie, so it must never be edge-rate-limited or the
  // subscription handshake fails (403/429) and messages get dropped.
  // The route enforces its own security instead (verify-token echo +
  // optional X-Hub-Signature-256 HMAC check).
  '/api/whatsapp/webhook',
  // Telegram bot webhook. Telegram's servers POST updates from their own
  // IPs with no session cookie; they must never be edge-rate-limited or
  // updates get dropped. The route enforces its own security instead
  // (optional X-Telegram-Bot-Api-Secret-Token check).
  '/api/telegram/webhook',
];

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function check(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= LIMIT) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  b.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to /api/* routes. Static assets, pages, and internal
  // Next.js handlers (/_next/*) are exempt.
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip the routes that have their own finer-grained limits. They
  // already return a structured 429 with a retryAfterSec field that the
  // client UI knows how to handle, so blocking them at the edge with a
  // generic 429 would just create two competing error shapes.
  for (const prefix of EXEMPT_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.next();
    }
  }

  const ip = clientIp(req);
  const result = check(ip);
  if (!result.ok) {
    return new NextResponse(
      JSON.stringify({
        error: 'tooManyRequests',
        retryAfterSec: result.retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(result.retryAfterSec),
          'x-ratelimit-limit': String(LIMIT),
          'x-ratelimit-remaining': '0',
        },
      }
    );
  }

  return NextResponse.next();
}

// Only run middleware on /api/* (exclude _next, static, and page routes).
export const config = {
  matcher: '/api/:path*',
};