import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEMO_ACCOUNTS, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

// POST /api/auth/login-as  { role }
//
// SECURITY: demo quick-login is disabled unless explicitly enabled for local
// development via ENABLE_DEMO_LOGIN=true, and is ALWAYS blocked in production
// builds regardless of configuration. Responds with 404 so the endpoint's
// existence is not revealed to probing clients.
export async function POST(req: NextRequest) {
  try {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_DEMO_LOGIN !== 'true'
    ) {
      return NextResponse.json({ error: 'notFound' }, { status: 404 });
    }

    const { role } = await req.json();
    if (
      role !== 'customer' &&
      role !== 'driver' &&
      role !== 'admin'
    ) {
      return NextResponse.json({ error: 'invalidRole' }, { status: 400 });
    }

    const demo = DEMO_ACCOUNTS[role as Role];
    let user = await db.user.findUnique({ where: { phone: demo.phone } });
    if (!user) {
      user = await db.user.create({
        data: {
          phone: demo.phone,
          name: demo.name,
          role: role as Role,
          accountStatus: 'active',
          phoneVerified: true,
        },
      });

      // If creating a driver demo account, also create a Driver profile so
      // the driver flow works without admin onboarding.
      if (role === 'driver') {
        const existingDriver = await db.driver.findUnique({
          where: { userId: user.id },
        });
        if (!existingDriver) {
          const vr = await db.vehicleRegistration.create({
            data: {
              numeroImmatriculation: `DEMO-${demo.phone.slice(-4)}`,
              typeProprietaire: 'PERSONNE_PHYSIQUE',
              nom: 'Demo',
              prenom: 'Driver',
              marque: 'TVS King',
              type: 'Triporteur 125cc',
              anneePremiereMiseCirculation: 2020,
            },
          });
          await db.driver.create({
            data: {
              userId: user.id,
              vehicleRegistrationId: vr.id,
              isOnline: true,
              isVerified: true,
            },
          });
        }
      }
    } else if (user.accountStatus !== 'active') {
      user = await db.user.update({
        where: { id: user.id },
        data: { accountStatus: 'active', phoneVerified: true },
      });
    }

    await setSession(user.id);

    const authUser: AuthUser = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role as Role,
      avatar: user.avatar,
    };
    return NextResponse.json({ user: authUser });
  } catch (e) {
    return NextResponse.json(
      { error: 'serverError', detail: String(e) },
      { status: 500 }
    );
  }
}
