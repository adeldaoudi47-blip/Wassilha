import { cookies } from 'next/headers';
import { createHmac, randomBytes, createHash, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db';
import type { AuthUser, Role } from './types';

export const SESSION_COOKIE = 'wassilha_session';
export const PHONE_VERIFICATION_COOKIE = 'wassilha_phone_verified';
const scrypt = promisify(nodeScrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function authSecret() {
  return process.env.AUTH_SECRET || process.env.SESSION_SECRET || 'wassilha-local-auth-secret';
}

/**
 * Validates the current session belongs to an ACTIVE artisan (role='artisan'
 * with an ArtisanProfile in status='active'). Returns the artisan profile id
 * so guarded routes can scope their queries (ownership checks).
 *
 * HIRFA (P5): product CRUD + image upload routes call this gate so the
 * artisan dashboard is fully server-authorised - hiding the button is never
 * the security (mirrors requirePrivilegedAdmin for admins).
 */
export async function requireActiveArtisan(): Promise<
  | { ok: true; session: AuthUser; artisanId: string }
  | { ok: false; status: 401; body: { error: 'unauthorized' } }
  | { ok: false; status: 403; body: { error: 'forbidden' | 'notAnArtisan' | 'artisanNotActive' } }
> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  if (session.role !== 'artisan') return { ok: false, status: 403, body: { error: 'forbidden' } };
  const profile = await db.artisanProfile.findUnique({
    where: { userId: session.id },
    select: { id: true, status: true },
  });
  if (!profile) return { ok: false, status: 403, body: { error: 'notAnArtisan' } };
  if (profile.status !== 'active') return { ok: false, status: 403, body: { error: 'artisanNotActive' } };
  return { ok: true, session, artisanId: profile.id };
}

// Sessions are stored as SHA-256 hashes server-side; the raw 256-bit random
// token exists only inside the user's httpOnly cookie and is never persisted.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function setPhoneVerification(phone: string) {
  const payload = `${phone}.${Date.now()}`;
  const signature = createHmac('sha256', authSecret()).update(payload).digest('hex');
  const store = await cookies();
  store.set(PHONE_VERIFICATION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  });
}

export async function getVerifiedPhone() {
  const store = await cookies();
  const value = store.get(PHONE_VERIFICATION_COOKIE)?.value;
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [phone, timestamp, signature] = parts;
  const payload = `${phone}.${timestamp}`;
  const expected = createHmac('sha256', authSecret()).update(payload).digest('hex');
  if (!/^0[567]\d{8}$/.test(phone) || !/^\d+$/.test(timestamp)) return null;
  if (Date.now() - Number(timestamp) > 15 * 60 * 1000) return null;
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return phone;
}

export async function clearPhoneVerification() {
  const store = await cookies();
  store.delete(PHONE_VERIFICATION_COOKIE);
}

export const DEMO_ACCOUNTS: Record<
  Role,
  {
    phone: string;
    name: string;
  }
> = {
  customer: {
    phone: '0660112233',
    name: 'زبون تجريبي',
  },
  driver: {
    phone: '0555123456',
    name: 'سائق تجريبي',
  },
  artisan: {
    phone: '0665987654',
    name: 'حرفي تجريبي',
  },
    admin: {
    phone: '0700000000',
    name: 'إدارة وصّلها',
  },
};

/**
 * Creates a cryptographically random session token (256-bit), persists ONLY
 * its SHA-256 hash with an absolute expiry, and sets the raw token in an
 * httpOnly cookie. User IDs are never used as session credentials.
 */
export async function setSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Opportunistic cleanup of this user's expired sessions.
  await db.session
    .deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
    .catch(() => undefined);

  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Extract the raw session token from a cookie header string. Used by
 * non-Next.js contexts (Socket.io upgrade handshake) where `cookies()` from
 * next/headers is unavailable.
 *
 * SECURITY: This is the only path by which the realtime server validates
 * identity. Without it, any client could join any user's room.
 */
function readTokenFromCookieHeader(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

/**
 * Resolves the current session from the opaque cookie token. Revocation is
 * immediate: the token must match a live, unexpired row in the Session table.
 *
 * SECURITY: a user with accountStatus !== "active" (e.g. a "pending" or
 * "rejected" driver) cannot hold a session — even if a stale cookie exists
 * (e.g. set by verify-otp before the admin approval workflow existed).
 *
 * @param cookieString Optional raw `Cookie:` header. When omitted, reads
 *   from `next/headers` (Next.js route handlers / server components only).
 *   Pass a string when calling from the Socket.io server, which cannot
 *   access Next.js cookies().
 */
export async function getSession(cookieString?: string): Promise<AuthUser | null> {
  let token: string | null = null;
  if (typeof cookieString === 'string') {
    token = readTokenFromCookieHeader(cookieString);
  } else {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value ?? null;
  }
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Expired — revoke lazily.
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const user = session.user;
  if (!user || user.accountStatus !== 'active') return null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role as Role,
    avatar: user.avatar,
  };
}

/** Logout / revocation: deletes the server-side session row, then the cookie. */
export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
}

/**
 * The only phone number authorized to hold the "admin" role.
 * Hard-coded as defense-in-depth so that even if an attacker finds a way to
 * mutate `User.role` directly (e.g. via a future code path that mis-trusts
 * client input), they still cannot reach admin APIs.
 *
 * The DB still owns the role assignment (no code path lets a non-bootstrap
 * user set role='admin'); this constant is the second gate.
 */
export const PRIVILEGED_ADMIN_PHONE = '0562166355';

/**
 * Validates the current session is held by the privileged admin
 * (phone === PRIVILEGED_ADMIN_PHONE) and that role === 'admin'.
 *
 * Return shape:
 *   { ok: true,  session } on success
 *   { ok: false, status: 401 | 403, body: { error: 'unauthorized' | 'forbidden' } } otherwise
 *
 * Use in admin API routes as:
 *   const gate = await requirePrivilegedAdmin();
 *   if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
 *   // gate.session is the verified AuthUser.
 */
export async function requirePrivilegedAdmin(): Promise<
  | { ok: true; session: AuthUser }
  | { ok: false; status: 401; body: { error: 'unauthorized' } }
  | { ok: false; status: 403; body: { error: 'forbidden' } }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }
  if (session.role !== 'admin' || session.phone !== PRIVILEGED_ADMIN_PHONE) {
    return { ok: false, status: 403, body: { error: 'forbidden' } };
  }
  return { ok: true, session };
}