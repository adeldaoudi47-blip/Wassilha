import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clearPhoneVerification, getVerifiedPhone, hashPassword, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export async function POST(req: NextRequest) {
  try {
    const phone = await getVerifiedPhone();
    if (!phone) return NextResponse.json({ error: 'phoneVerificationRequired' }, { status: 403 });
    const { name, email, password, confirmPassword } = await req.json();
    if (typeof name !== 'string' || name.trim().length < 2) return NextResponse.json({ error: 'invalidName' }, { status: 400 });
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return NextResponse.json({ error: 'invalidEmail' }, { status: 400 });
    if (typeof password !== 'string' || !PASSWORD_RE.test(password)) return NextResponse.json({ error: 'weakPassword' }, { status: 400 });
    if (password !== confirmPassword) return NextResponse.json({ error: 'passwordMismatch' }, { status: 400 });

    const normalizedEmail = email.trim().toLowerCase();
    const existingPhone = await db.user.findUnique({ where: { phone } });
    if (existingPhone?.accountStatus === 'active') return NextResponse.json({ error: 'phoneAlreadyUsed' }, { status: 409 });
    const existingEmail = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existingEmail && existingEmail.phone !== phone) return NextResponse.json({ error: 'emailAlreadyUsed' }, { status: 409 });

    const passwordHash = await hashPassword(password);
    // SECURITY: this endpoint is the CUSTOMER signup path only.
    // We do NOT read role / accountStatus / isVerified from the request body —
    // role is forced to "customer" and accountStatus to "active" server-side.
    // Driver applications MUST go through /api/auth/apply-driver.
    const user = existingPhone
      ? await db.user.update({
          where: { phone },
          data: {
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            phoneVerified: true,
            accountStatus: 'active',
            // Explicitly do NOT touch role here. If a previous incomplete
            // signup left role at the default "customer", this is a no-op.
          },
        })
      : await db.user.create({
          data: {
            phone,
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            phoneVerified: true,
            accountStatus: 'active',
            role: 'customer', // FORCED — never trust client-supplied role
          },
        });
    await clearPhoneVerification();
    await setSession(user.id);
    const authUser: AuthUser = { id: user.id, phone: user.phone, name: user.name, role: user.role as Role, avatar: user.avatar };
    return NextResponse.json({ user: authUser });
  } catch (e) {
    return NextResponse.json({ error: 'serverError', detail: String(e) }, { status: 500 });
  }
}