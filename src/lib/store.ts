import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, Lang, Role } from './types';

// Persisted UI state: auth + language + role-view toggle
// `viewMode` is a PURELY CLIENT-SIDE view switch: a driver/artisan can
// browse the app with the customer UI without user.role changing in the
// DB or in the session (see setViewMode below).
type ViewMode = 'default' | 'customer';

interface AppState {
  user: AuthUser | null;
  lang: Lang;
  viewMode: ViewMode;
  setLang: (lang: Lang) => void;
  setUser: (user: AuthUser | null) => void;
  setViewMode: (mode: ViewMode) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      lang: 'ar',
      viewMode: 'default',
      setLang: (lang) => set({ lang }),
      setUser: (user) => set({ user }),
      setViewMode: (viewMode) => set({ viewMode }),
      // Logging out resets the view so the next session opens on the
      // user's real role dashboard.
      logout: () => set({ user: null, viewMode: 'default' }),
    }),
    { name: 'wassilha-store' }
  )
);

// Non-persisted navigation state (in-memory, resets on refresh — desired for a single-page app)
// TRIP OFFERS: `offers` is a new screen on both customer and driver
// sides. The customer browses available offers; the driver
// manages their own published offers.
type CustomerScreen = 'home' | 'hirfa' | 'cart' | 'track' | 'history' | 'profile' | 'offers';
type DriverScreen = 'requests' | 'trips' | 'earnings' | 'profile' | 'offers';
type ArtisanScreen = 'dashboard' | 'products' | 'orders' | 'profile';
type AdminScreen = 'dashboard' | 'drivers' | 'orders' | 'pricing' | 'applications' | 'fleet' | 'craft';

interface NavState {
  customerTab: CustomerScreen;
  driverTab: DriverScreen;
  artisanTab: ArtisanScreen;
  adminTab: AdminScreen;
  activeOrderId: string | null;
  setCustomerTab: (t: CustomerScreen) => void;
  setDriverTab: (t: DriverScreen) => void;
  setArtisanTab: (t: ArtisanScreen) => void;
  setAdminTab: (t: AdminScreen) => void;
  setActiveOrderId: (id: string | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  customerTab: 'home',
  driverTab: 'requests',
  artisanTab: 'dashboard',
  adminTab: 'dashboard',
  activeOrderId: null,
  setCustomerTab: (t) => set({ customerTab: t }),
  setDriverTab: (t) => set({ driverTab: t }),
  setArtisanTab: (t) => set({ artisanTab: t }),
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
//
// HIRFA Phase 3: a line now carries the chosen `variantId` (null for
// variant-less products). The dedup key is therefore productId|variantId —
// the same key the server uses — so the same product in two different
// variants sits as two separate lines and never silently merges.
export interface CraftCartItem {
  productId: string;
  variantId: string | null;
  nameAr: string;
  // Display price at the time of adding (UX only — the server recomputes it
  // from the tier + variant at checkout).
  price: number;
  image: string | null;
  qty: number;
}

interface CraftCartState {
  items: CraftCartItem[];
  // HIRFA Phase 3: ONE coupon code for the whole cart. The server scopes it
  // to a single artisan, so in a multi-store cart it only discounts the
  // matching store's order.
  couponCode: string | null;
  addItem: (item: Omit<CraftCartItem, "qty">, qty?: number) => void;
  removeItem: (productId: string, variantId?: string | null) => void;
  setCouponCode: (code: string | null) => void;
  clear: () => void;
}

// Same key the checkout API deduplicates on: variant-less lines use
// variantId === null, so "no variant" is a distinct, stable key.
function lineKey(productId: string, variantId?: string | null) {
  return `${productId}|${variantId ?? ''}`;
}

// C8 (cart persistence): the cart is wrapped in `persist` so a page
// refresh / app kill no longer empties it — an abandoned cart was
// directly costing store sales. This store holds NO PII and NO auth
// data (only productId/variantId/name/price/image/qty), and the server
// recomputes every price at checkout, so a stale or edited cache can never
// be trusted for pricing. `wassilha-craft-cart` is a separate storage key
// from the auth store (`wassilha-store`) on purpose.
export const useCraftCart = create<CraftCartState>()(
  persist(
    (set) => ({
      items: [],
      couponCode: null,
      addItem: (item, qty = 1) =>
        set((s) => {
          const key = lineKey(item.productId, item.variantId);
          const existing = s.items.find((i) => lineKey(i.productId, i.variantId) === key);
          const items = existing
            ? s.items.map((i) =>
                lineKey(i.productId, i.variantId) === key ? { ...i, qty: i.qty + qty } : i
              )
            : [...s.items, { ...item, qty }];
          return { items };
        }),
      removeItem: (productId, variantId = null) =>
        set((s) => {
          const key = lineKey(productId, variantId);
          return { items: s.items.filter((i) => lineKey(i.productId, i.variantId) !== key) };
        }),
      setCouponCode: (couponCode) => set({ couponCode }),
      clear: () => set({ items: [], couponCode: null }),
    }),
    { name: 'wassilha-craft-cart' }
  )
);