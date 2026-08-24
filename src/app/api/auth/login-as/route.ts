import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEMO_ACCOUNTS, setSession } from '@/lib/auth';
import type { AuthUser, Role } from '@/lib/types';

// POST /api/auth/login-as  { role }
export async function POST(req: NextRequest) {
  try {
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
        },
      });

      // If creating a driver demo account, also create a Driver profile so
      // the driver flow works without admin onboarding.
      if (role === 'driver') {
        const existingDriver = await db.driver.findUnique({
          where: { userId: user.id },
        });
        if (!existingDriver) {
          await db.driver.create({
            data: {
              userId: user.id,
              vehicleType: 'Triporteur 125cc',
              vehicleColor: 'أزرق',
              isOnline: true,
              isVerified: true,
            },
          });
        }
      }
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
