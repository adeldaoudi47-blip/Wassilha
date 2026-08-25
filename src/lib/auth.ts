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
 * Resolves the current session from the opaque cookie token. Revocation is
 * immediate: the token must match a live, unexpired row in the Session table.
 */
export async function getSession(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
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