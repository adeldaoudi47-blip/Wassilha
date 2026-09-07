'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useNavStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useT } from '@/components/wassilha/use-t';
import { useRealtime } from '@/components/wassilha/use-realtime';
import { AuthFlow } from '@/components/wassilha/auth/auth-flow';
import { AppShell } from '@/components/wassilha/app-shell';
import { CustomerHome } from '@/components/wassilha/customer/customer-home';
import { HirfaHome } from '@/components/wassilha/craft/hirfa-home';
import { CustomerTrack } from '@/components/wassilha/customer/customer-track';
import { CustomerHistory } from '@/components/wassilha/customer/customer-history';
import { CustomerProfile } from '@/components/wassilha/customer/customer-profile';
import { DriverRequests } from '@/components/wassilha/driver/driver-requests';
import { DriverOffers } from '@/components/wassilha/driver/driver-offers';
import { CustomerOffers } from '@/components/wassilha/customer/customer-offers';
import { DriverTrips } from '@/components/wassilha/driver/driver-trips';
import { DriverEarnings } from '@/components/wassilha/driver/driver-earnings';
import { DriverProfile } from '@/components/wassilha/driver/driver-profile';
import { AdminDashboard } from '@/components/wassilha/admin/admin-dashboard';
import { AdminDrivers } from '@/components/wassilha/admin/admin-drivers';
import { AdminOrders } from '@/components/wassilha/admin/admin-orders';
import { AdminPricing } from '@/components/wassilha/admin/admin-pricing';
import { AdminDriverApplications } from '@/components/wassilha/admin/admin-driver-applications';
import { AdminArtisanApplications } from '@/components/wassilha/admin/admin-artisan-applications';
import { AdminFleetMap } from '@/components/wassilha/admin/admin-fleet-map';
import { ArtisanDashboard } from '@/components/wassilha/craft/artisan-dashboard';
import { CraftCart } from '@/components/wassilha/craft/craft-cart';

export default function Home() {
  const { t, isRtl } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const customerTab = useNavStore((s) => s.customerTab);
  const driverTab = useNavStore((s) => s.driverTab);
  const adminTab = useNavStore((s) => s.adminTab);
  const artisanTab = useNavStore((s) => s.artisanTab);
  const [booting, setBooting] = useState(true);

  // Sync document direction with language
  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = isRtl ? 'ar' : 'fr';
  }, [isRtl]);

  // Connect/disconnect realtime socket based on user
  useRealtime();

  // Restore session on mount
  useEffect(() => {
    api.me()
      .then(({ user: u }) => { if (u) setUser(u); })
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [setUser]);

  if (booting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-primary">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <p className="text-sm font-semibold text-white/80">وَصِّلها · WASSILHA</p>
      </div>
    );
  }

  if (!user) {
    return <AuthFlow />;
  }

  // Render based on role + active tab
  let title = t.home;
  let subtitle: string | undefined;
  let content: React.ReactNode = null;

  if (user.role === 'customer') {
    if (customerTab === 'home') { title = t.home; subtitle = t.tagline; content = <CustomerHome />; }
    else if (customerTab === 'hirfa') { title = t.hirfa; subtitle = t.hirfaMarketplace; content = <HirfaHome />; }
    else if (customerTab === 'track') { title = t.track; content = <CustomerTrack />; }
    else if (customerTab === 'history') { title = t.history; content = <CustomerHistory />; }
    else if (customerTab === 'profile') { title = t.profile; content = <CustomerProfile />; }
    // TRIP OFFERS: dedicated tab for browsing driver-published offers.
    else if (customerTab === 'offers') { title = t.tripOffers; content = <CustomerOffers />; }
    else if (customerTab === 'cart') { title = t.cart; content = <CraftCart />; }
  } else if (user.role === 'driver') {
    if (driverTab === 'requests') { title = t.incomingRequests; subtitle = t.location; content = <DriverRequests />; }
    else if (driverTab === 'trips') { title = t.myTrips; content = <DriverTrips />; }
    else if (driverTab === 'earnings') { title = t.earnings; content = <DriverEarnings />; }
    else if (driverTab === 'profile') { title = t.profile; content = <DriverProfile />; }
    // TRIP OFFERS: dedicated tab for managing the driver's own
    // published offers (publish / cancel).
    else if (driverTab === 'offers') { title = t.myOffers; content = <DriverOffers />; }
  } else if (user.role === 'admin') {
    if (adminTab === 'dashboard') { title = t.dashboard; subtitle = t.location; content = <AdminDashboard />; }
    else if (adminTab === 'fleet') { title = t.fleetMap; subtitle = t.location; content = <AdminFleetMap />; }
    else if (adminTab === 'applications') { title = t.driverApplications; content = <AdminDriverApplications />; }
    else if (adminTab === 'craft') { title = t.craftApplications; content = <AdminArtisanApplications />; }
    else if (adminTab === 'drivers') { title = t.drivers; content = <AdminDrivers />; }
    else if (adminTab === 'orders') { title = t.orders; content = <AdminOrders />; }
    else if (adminTab === 'pricing') { title = t.pricing; content = <AdminPricing />; }
  } else if (user.role === 'artisan') {
    if (artisanTab === 'dashboard') { title = t.artisanDashboard; subtitle = t.hirfa; content = <ArtisanDashboard />; }
    else if (artisanTab === 'products') { title = t.myProducts; content = <ArtisanDashboard />; }
    else if (artisanTab === 'orders') { title = t.newOrder; content = <ArtisanDashboard />; }
    else if (artisanTab === 'profile') { title = t.profile; content = <ArtisanDashboard />; }
  }

  return (
    <AppShell role={user.role} title={title} subtitle={subtitle}>
      {content}
    </AppShell>
  );
}
