'use client';

import { Home, ClipboardList, User, Bike, Wallet, LayoutDashboard, Users, Package, Tags } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from './use-t';
import { useNavStore } from '@/lib/store';
import { AppHeader } from './app-header';
import type { Role } from '@/lib/types';

interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const CUSTOMER_NAV: NavItem[] = [
  { key: 'home', label: 'home', icon: Home },
  { key: 'history', label: 'history', icon: ClipboardList },
  { key: 'profile', label: 'profile', icon: User },
];
const DRIVER_NAV: NavItem[] = [
  { key: 'requests', label: 'incomingRequests', icon: Bike },
  { key: 'trips', label: 'myTrips', icon: Package },
  { key: 'earnings', label: 'earnings', icon: Wallet },
  { key: 'profile', label: 'profile', icon: User },
];
const ADMIN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard },
  { key: 'drivers', label: 'drivers', icon: Users },
  { key: 'orders', label: 'orders', icon: ClipboardList },
  { key: 'pricing', label: 'pricing', icon: Tags },
];

const NAVS: Record<Role, NavItem[]> = {
  customer: CUSTOMER_NAV,
  driver: DRIVER_NAV,
  admin: ADMIN_NAV,
};

export function BottomNav({ role }: { role: Role }) {
  const { t } = useT();
  const items = NAVS[role];

  // Call all hooks unconditionally to satisfy rules-of-hooks
  const customerTab = useNavStore((s) => s.customerTab);
  const driverTab = useNavStore((s) => s.driverTab);
  const adminTab = useNavStore((s) => s.adminTab);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const setDriverTab = useNavStore((s) => s.setDriverTab);
  const setAdminTab = useNavStore((s) => s.setAdminTab);

  const activeTab = role === 'customer' ? customerTab : role === 'driver' ? driverTab : adminTab;
  const setter = role === 'customer' ? setCustomerTab : role === 'driver' ? setDriverTab : setAdminTab;

  return (
    <nav className="sticky bottom-0 z-30 border-t border-border/60 bg-background/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          const label = (t as unknown as Record<string, string>)[item.label] ?? item.label;
          return (
            <button
              key={item.key}
              onClick={() => setter(item.key as never)}
              className={cn(
                'group relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {active && (
                <span className="absolute -top-px h-0.5 w-8 rounded-full bg-primary" />
              )}
              <Icon size={20} className={cn('transition-transform', active && 'scale-110')} />
              <span className="text-[10px] font-semibold leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({
  role,
  title,
  subtitle,
  children,
}: {
  role: Role;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader title={title} subtitle={subtitle} />
      <main className="wassilha-scroll mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24">{children}</main>
      <BottomNav role={role} />
    </div>
  );
}
