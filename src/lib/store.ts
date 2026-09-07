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
// TRIP OFFERS: `offers` is a new screen on both customer and driver
// sides. The customer browses available offers; the driver
// manages their own published offers.
type CustomerScreen = 'home' | 'hirfa' | 'track' | 'history' | 'profile' | 'offers';
type DriverScreen = 'requests' | 'trips' | 'earnings' | 'profile' | 'offers';
type AdminScreen = 'dashboard' | 'drivers' | 'orders' | 'pricing' | 'applications' | 'fleet' | 'craft';

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


// HIRFA (P3): lightweight client-side cart for craft products. UX-only
// state - the server recomputes every price at checkout (P6) and never
// trusts anything stored here.
export interface CraftCartItem {
  productId: string;
  nameAr: string;
  price: number;
  image: string | null;
  qty: number;
}

interface CraftCartState {
  items: CraftCartItem[];
  addItem: (item: Omit<CraftCartItem, "qty">, qty?: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
}

export const useCraftCart = create<CraftCartState>((set) => ({
  items: [],
  addItem: (item, qty = 1) =>
    set((s) => {
      const existing = s.items.find((i) => i.productId === item.productId);
      const items = existing
        ? s.items.map((i) => (i.productId === item.productId ? { ...i, qty: i.qty + qty } : i))
        : [...s.items, { ...item, qty }];
      return { items };
    }),
  removeItem: (productId) => set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
  clear: () => set({ items: [] }),
}));