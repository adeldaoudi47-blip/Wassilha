'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAppStore, useCraftCart, useFavorites } from '@/lib/store';

/**
 * PHASE 10 أ¢â‚¬â€‌ login merge hook (called once per app boot AND on auth changes).
 *
 * Wires the localStorage/zustand mirrors (craft cart + favourites) to their
 * server counterparts (/api/craft/cart, /api/craft/favorites):
 *
 *   - Guest device أ¢â€ â€™ session exists: GET the server state, UNION it with the
 *     local state (cart: max-qty merge per productId|variantId key; favorites:
 *     set-union), apply the merged result to the local store, then PUT the
 *     merged result back so the server converges to the union.
 *   - No session: local state is kept as-is (guests can still build a cart /
 *     wishlist; it syncs on their next login).
 *   - POST-login push: when a user signs in *while the app is open* (state
 *     flips null أ¢â€ â€™ user), we re-merge so a cart built as a guest lands in
 *     their account.
 *   - Logout: per app convention the LOCAL state is kept (the device keeps
 *     its cart; the server copy stays for the account).
 *
 * The merge is best-effort and completely silent: any failure (offline,
 * 429, 500) leaves local state untouched أ¢â‚¬â€‌ the UX source of truth is never
 * degraded by the mirror.
 */

/**
 * Fire-and-forget cart mirror used by every cart-mutating UI (add-to-cart on
 * the detail page, the public SEO page, the cart screen's qty/remove/coupon
 * actions). Sends a FULL replacement of the local cart أ¢â‚¬â€‌ the server PUT is
 * a whole-set replace, and the server itself re-validates visibility,
 * dedupes, and never accepts a price from the wire.
 *
 * Never throws. Guests (401) and any other failure are swallowed: the
 * localStorage cart stays the UX source of truth and the login merge in
 * syncCraftMirrors() converges the server copy later.
 */
export function syncCraftCartToServer(): void {
  const { items, couponCode } = useCraftCart.getState();
  void api
    .putCraftCart({
      items: items.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        qty: l.qty,
      })),
      couponCode,
    })
    .catch(() => {
      /* silent - mirror only */
    });
}

let lastSyncedUser: string | null | undefined = undefined;

export function syncCraftMirrors(): void {
  const user = useAppStore.getState().user;
  const userId = user?.id ?? null;

  // Skip when the auth identity did not actually change (repeated calls on
    // unrelated re-renders must not hammer the endpoints أ¢â‚¬â€‌ rate limits apply).
  if (lastSyncedUser === userId) return;
  lastSyncedUser = userId;

  if (!userId) return; // guest: keep local state, nothing to merge yet

  void (async () => {
    try {
      // ---- Favourites: union of local ids + server ids -------------------
      const serverFavs = await api.getFavorites();
      const localFavs = useFavorites.getState().productIds;
      const mergedFavs = [...new Set([...localFavs, ...serverFavs.productIds])];
      if (
        mergedFavs.length !== localFavs.length ||
        mergedFavs.some((id, i) => id !== localFavs[i])
      ) {
        useFavorites.getState().setAll(mergedFavs);
        // Push the union back so the server converges (server validates
        // visibility and drops anything not publicly visible right now).
        await api.putFavorites(mergedFavs);
      }

      // ---- Cart: union of local lines + server lines (max-qty per key) ---
      const serverCart = await api.getCraftCart();
      const store = useCraftCart.getState();
      const localLines = store.items;
      const byKey = new Map<
        string,
        { productId: string; variantId: string | null; nameAr: string; price: number; image: string | null; qty: number }
      >();
      // Local lines win on display fields (fresher preview prices).
      for (const l of localLines) {
        byKey.set(`${l.productId}|${l.variantId ?? ''}`, { ...l });
      }
      for (const l of serverCart.items) {
        const key = `${l.productId}|${l.variantId ?? ''}`;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, { ...l });
        } else if (l.qty > existing.qty) {
          byKey.set(key, { ...existing, qty: l.qty });
        }
      }
      const mergedCoupon = store.couponCode ?? serverCart.couponCode ?? null;
      const mergedItems = [...byKey.values()];
      const serverChanged =
        serverCart.items.some((l) => {
          const k = `${l.productId}|${l.variantId ?? ''}`;
          const local = localLines.find((x) => `${x.productId}|${x.variantId ?? ''}` === k);
          return !local || l.qty > local.qty;
        }) || mergedItems.length !== localLines.length;
      if (serverChanged || mergedCoupon !== store.couponCode) {
        store.setAll(mergedItems, mergedCoupon);
        // Mirror the union back (server filters to publicly visible products
        // and echoes no counts أ¢â‚¬â€‌ see /api/craft/cart PUT).
        syncCraftCartToServer();
      }
    } catch {
      // Best-effort by design: offline / rate-limited / server error أ¢â‚¬â€‌ the
      // local state stays as-is and the next login or reload re-merges.
    }
  })();
}

/**
 * Mounted once (root layout). Fires the merge on first boot (covers a hard
 * refresh with an existing session) and whenever the signed-in user changes
 * (covers in-app login without a reload).
 */
export function CraftSyncBootstrap(): null {
  const user = useAppStore((s) => s.user);
  useEffect(() => {
    syncCraftMirrors();
  }, [user?.id]);
  return null;
}
