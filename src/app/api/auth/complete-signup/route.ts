import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { clearPhoneVerification, getVerifiedPhone, hashPassword, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

// OWASP — API3:2023 (Broken Object Property Level Authorization):
// validate every body field with Zod before touching the DB. The hand-
// rolled regexes below have been replaced with a single schema so the
// client gets a structured 400 and a clear list of what is wrong.
const completeSignupSchema = z
  .object({
    name: z.string().trim().min(2, 'invalidName').max(100, 'invalidName'),
    email: z.string().trim().email('invalidEmail').max(254, 'invalidEmail'),
    password: z
      .string()
      // Strong password: 8+ chars, at least one lowercase, one uppercase,
      // one digit. This matches the previous hand-rolled rule and keeps
      // the existing client-side UX the same.
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
        'weakPassword'
      ),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  });

function badRequest(error: string, issues?: unknown) {
  return NextResponse.json({ error, issues }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const phone = await getVerifiedPhone();
    if (!phone) return NextResponse.json({ error: 'phoneVerificationRequired' }, { status: 403 });

    const raw = await req.json();
    const parsed = completeSignupSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return badRequest(first?.message ?? 'invalidBody', parsed.error.issues);
    }
    const { name, email, password } = parsed.data;
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