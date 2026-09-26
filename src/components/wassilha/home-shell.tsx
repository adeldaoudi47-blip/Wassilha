'use client';

// Client shell for the root route: owns the Zustand session, the api.me()
// restore, the realtime socket and the role/tab switcher that the whole app
// UI hangs off. Everything here used to live directly in `src/app/page.tsx`.
//
// It was moved out so that `page.tsx` could become a Server Component holding
// the SEO metadata, while all interactive behaviour stayed exactly as it was.
// The Zustand-driven bottom navigation is untouched — only the anonymous
// entry point changed: a visitor now lands on the marketing page and taps a
// CTA to open the same <AuthFlow /> as before, instead of being dropped
// straight into the phone-number form.

import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore, useNavStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useT } from '@/components/wassilha/use-t';
import { useRealtime } from '@/components/wassilha/use-realtime';
import { AuthFlow } from '@/components/wassilha/auth/auth-flow';
import { AppShell } from '@/components/wassilha/app-shell';
import { LandingPage } from '@/components/wassilha/landing-page';
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
import type { Role } from '@/lib/types';

export function HomeShell() {
  const { t, isRtl } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const viewMode = useAppStore((s) => s.viewMode);
  const customerTab = useNavStore((s) => s.customerTab);
  const driverTab = useNavStore((s) => s.driverTab);
  const adminTab = useNavStore((s) => s.adminTab);
  const artisanTab = useNavStore((s) => s.artisanTab);
  const [booting, setBooting] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);

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

  // The landing is ALWAYS in the first payload so crawlers and link previews
  // read the <h1> + service copy without executing JS. It is only hidden once
  // a session is actually restored, and the boot splash below is a fixed
  // overlay so a returning user never sees a flash of the landing page.
  const appReady = !booting && Boolean(user);

  // Render based on role + active tab
  //
  // ROLE VIEW SWITCH (UI-only): a driver/artisan who flipped `viewMode` to
  // 'customer' browses the app with the CUSTOMER ui + bottom nav. This never
  // touches user.role in the DB or in the session — it is a pure view toggle.
  const effectiveRole: Role =
    (user?.role === 'driver' || user?.role === 'artisan') && viewMode === 'customer'
      ? 'customer'
      : (user?.role as Role);

  let title = t.home;
  let subtitle: string | undefined;
  let content: ReactNode = null;

  if (user && !booting) {
    if (effectiveRole === 'customer') {
      if (customerTab === 'home') { title = t.home; subtitle = t.tagline; content = <CustomerHome />; }
      else if (customerTab === 'hirfa') { title = t.hirfa; subtitle = t.hirfaMarketplace; content = <HirfaHome />; }
      else if (customerTab === 'track') { title = t.track; content = <CustomerTrack />; }
      else if (customerTab === 'history') { title = t.history; content = <CustomerHistory />; }
      else if (customerTab === 'profile') { title = t.profile; content = <CustomerProfile />; }
      // TRIP OFFERS: dedicated tab for browsing driver-published offers.
      else if (customerTab === 'offers') { title = t.tripOffers; content = <CustomerOffers />; }
      else if (customerTab === 'cart') { title = t.cart; content = <CraftCart />; }
    } else if (effectiveRole === 'driver') {
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
    } else if (effectiveRole === 'artisan') {
      if (artisanTab === 'dashboard') { title = t.artisanDashboard; subtitle = t.hirfa; content = <ArtisanDashboard />; }
      else if (artisanTab === 'products') { title = t.myProducts; content = <ArtisanDashboard />; }
      else if (artisanTab === 'orders') { title = t.newOrder; content = <ArtisanDashboard />; }
      else if (artisanTab === 'profile') { title = t.profile; content = <ArtisanDashboard />; }
    }
  }

  return (
    <>
      <div hidden={appReady}>
        <LandingPage onStart={() => setAuthOpen(true)} />
      </div>

      {booting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-primary">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <p className="text-sm font-semibold text-white/80">وَصِّلها · WASSILHA</p>
        </div>
      )}

      {!booting && !user && authOpen && <AuthFlow />}

      {appReady && (
        <AppShell role={effectiveRole} title={title} subtitle={subtitle}>
          {content}
        </AppShell>
      )}
    </>
  );
}
