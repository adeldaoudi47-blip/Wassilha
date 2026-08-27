import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, Lang, Role } from './types';

// Persisted UI state: auth + language
interface AppState {
  user: AuthUser | null;
  lang: Lang;
  setLang: (lang: Lang) => void;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      lang: 'ar',
      setLang: (lang) => set({ lang }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    { name: 'wassilha-store' }
  )
);

// Non-persisted navigation state (in-memory, resets on refresh — desired for a single-page app)
type CustomerScreen = 'home' | 'track' | 'history' | 'profile';
type DriverScreen = 'requests' | 'trips' | 'earnings' | 'profile';
type AdminScreen = 'dashboard' | 'drivers' | 'orders' | 'pricing' | 'applications';

interface NavState {
  customerTab: CustomerScreen;
  driverTab: DriverScreen;
  adminTab: AdminScreen;
  activeOrderId: string | null;
  setCustomerTab: (t: CustomerScreen) => void;
  setDriverTab: (t: DriverScreen) => void;
  setAdminTab: (t: AdminScreen) => void;
  setActiveOrderId: (id: string | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  customerTab: 'home',
  driverTab: 'requests',
  adminTab: 'dashboard',
  activeOrderId: null,
  setCustomerTab: (t) => set({ customerTab: t }),
  setDriverTab: (t) => set({ driverTab: t }),
  setAdminTab: (t) => set({ adminTab: t }),
  setActiveOrderId: (id) => set({ activeOrderId: id }),
}));

// Convenience: role derived from user
export function useRole(): Role | null {
  const user = useAppStore((s) => s.user);
  return user?.role ?? null;
}
