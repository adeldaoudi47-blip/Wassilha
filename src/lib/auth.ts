import { cookies } from 'next/headers';
import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db';
import type { AuthUser, Role } from './types';

export const SESSION_COOKIE = 'wassilha_session';
export const PHONE_VERIFICATION_COOKIE = 'wassilha_phone_verified';
const scrypt = promisify(nodeScrypt);

function authSecret() {
  return process.env.AUTH_SECRET || process.env.SESSION_SECRET || 'wassilha-local-auth-secret';
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

export async function getSession(): Promise<AuthUser | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;

  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) return null;
  if (user.accountStatus !== 'active') return null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role as Role,
    avatar: user.avatar,
  };
}

export async function setSession(userId: string) {
  const store = await cookies();

  store.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}