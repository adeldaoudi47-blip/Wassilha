'use client';

import { Home, ClipboardList, User, Bike, Wallet, LayoutDashboard, Users, Package, Tags, ShieldCheck, MapPin, CalendarClock, Hammer, Scissors, Store, ShoppingBag, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from './use-t';
import { useAppStore, useNavStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { AppHeader } from './app-header';
import type { Role } from '@/lib/types';

interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const CUSTOMER_NAV: NavItem[] = [
  { key: 'home', label: 'home', icon: Home },
  // HIRFA marketplace (craft) - dedicated customer tab (P3).
  { key: 'hirfa', label: 'hirfa', icon: Hammer },
  // HIRFA (P6): craft cart tab.
  { key: 'cart', label: 'cart', icon: ShoppingBag },
  // TRIP OFFERS: customer browses available offers. Sits between
  // `home` and `history` so it's discoverable without being
  // aggressive on the home screen.
  { key: 'offers', label: 'tripOffers', icon: CalendarClock },
  { key: 'history', label: 'history', icon: ClipboardList },
  { key: 'profile', label: 'profile', icon: User },
];
const DRIVER_NAV: NavItem[] = [
  { key: 'requests', label: 'incomingRequests', icon: Bike },
  { key: 'trips', label: 'myTrips', icon: Package },
  // TRIP OFFERS: driver manages their own published offers.
  // Sits between `trips` and `earnings` to keep the workflow
  // contiguous (request -> trip -> manage offer -> earn).
  { key: 'offers', label: 'myOffers', icon: CalendarClock },
  { key: 'earnings', label: 'earnings', icon: Wallet },
  { key: 'profile', label: 'profile', icon: User },
];
const ARTISAN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'artisanDashboard', icon: Store },
  { key: 'products', label: 'myProducts', icon: Package },
  // HIRFA (P6): artisan order management tab.
  { key: 'orders', label: 'newOrder', icon: Clock },
  { key: 'profile', label: 'profile', icon: User },
];
const ADMIN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard },
  { key: 'fleet', label: 'fleetMap', icon: MapPin },
  { key: 'applications', label: 'driverApplications', icon: ShieldCheck },
  // HIRFA (P4): artisan store applications review tab.
  { key: 'craft', label: 'craftApplications', icon: Scissors },
  { key: 'drivers', label: 'drivers', icon: Users },
  { key: 'orders', label: 'orders', icon: ClipboardList },
  { key: 'pricing', label: 'pricing', icon: Tags },
];

const NAVS: Record<Role, NavItem[]> = {
  customer: CUSTOMER_NAV,
  driver: DRIVER_NAV,
  artisan: ARTISAN_NAV,
  admin: ADMIN_NAV,
};

export function BottomNav({ role }: { role: Role }) {
  const { t } = useT();
  const items = NAVS[role];

  // Call all hooks unconditionally to satisfy rules-of-hooks
  const customerTab = useNavStore((s) => s.customerTab);
  const driverTab = useNavStore((s) => s.driverTab);
  const adminTab = useNavStore((s) => s.adminTab);
  const artisanTab = useNavStore((s) => s.artisanTab);
  const setArtisanTab = useNavStore((s) => s.setArtisanTab);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const setDriverTab = useNavStore((s) => s.setDriverTab);
  const setAdminTab = useNavStore((s) => s.setAdminTab);

  const activeTab = role === 'customer' ? customerTab : role === 'driver' ? driverTab : role === 'artisan' ? artisanTab : adminTab;
  const setter = role === 'customer' ? setCustomerTab : role === 'driver' ? setDriverTab : role === 'artisan' ? setArtisanTab : setAdminTab;

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
    const { t } = useT();
  const user = useAppStore((s) => s.user);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  // Sticky Return Banner: always reachable. Shown only when a driver/artisan
  // is browsing in customer mode (viewMode === 'customer'). Tapping it flips
  // back to the real dashboard without any DB/session role change.
  const inCustomerView =
    viewMode === 'customer' && user && (user.role === 'driver' || user.role === 'artisan');
  const returnLabel = user?.role === 'driver' ? t.switchToDriver : t.switchToArtisan;

  return (
    <div className="flex min-h-screen flex-col">
      {inCustomerView && (
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-3 py-2.5 text-xs">
          <span className="text-muted-foreground">{t.customerViewMode}</span>
          <Button
            size="sm"
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
            onClick={() => setViewMode('default')}
          >
            {returnLabel}
          </Button>
        </div>
      )}
      <AppHeader title={title} subtitle={subtitle} />
      <main className="wassilha-scroll mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24">{children}</main>
      <BottomNav role={role} />
    </div>
  );
}
