import { cookies } from 'next/headers';
import { db } from './db';
import type { AuthUser, Role } from './types';

export const SESSION_COOKIE = 'wassilha_session';
// Demo OTP — in production this would be sent via SMS
export const DEMO_OTP = '0000';

export async function getSession(): Promise<AuthUser | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
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
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// Demo accounts for quick role switching (no OTP needed)
export const DEMO_ACCOUNTS: Record<Role, { phone: string; name: string }> = {
  customer: { phone: '0660112233', name: 'سفيان بوزيد' },
  driver: { phone: '0555123456', name: 'أحمد بن سالم' },
  admin: { phone: '0700000000', name: 'إدارة وصّلها' },
};
