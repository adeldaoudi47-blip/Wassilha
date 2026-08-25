import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setSession, verifyPassword } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (typeof email !== 'string' || typeof password !== 'string') return NextResponse.json({ error: 'invalidCredentials' }, { status: 400 });
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || user.accountStatus !== 'active' || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: 'invalidCredentials' }, { status: 401 });
    }
    await setSession(user.id);
    const authUser: AuthUser = { id: user.id, phone: user.phone, name: user.name, role: user.role as Role, avatar: user.avatar };
    return NextResponse.json({ user: authUser });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}