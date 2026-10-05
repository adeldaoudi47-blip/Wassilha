'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useFavorites } from '@/lib/store';
import { useT } from '../use-t';

/**
 * PHASE 10 — shared favourite (heart) toggle used by the product card and the
 * product detail screen.
 *
 * Dual-write: the local zustand store (`wassilha-favorites`) is the UX source
 * of truth — the heart flips INSTANTLY so the UI never waits on the network —
 * and the server mirror is updated fire-and-forget:
 *   - signed in → POST/DELETE /api/craft/favorites/[productId]
 *   - guest → nothing to sync; the id merges into the account on next login
 *     (the boot merge in src/lib/cart-sync.ts PUTs the union).
 *
 * A failed server call (e.g. 404 because the product was suspended between
 * render and tap) rolls the local heart back so the UI never lies about what
 * the account actually saved.
 */
export function useFavoriteToggle(): {
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
} {
  const { t } = useT();
  const productIds = useFavorites((s) => s.productIds);
  const toggleLocal = useFavorites((s) => s.toggle);

  const isFavorite = useCallback(
    (productId: string) => productIds.includes(productId),
    [productIds]
  );

  const toggleFavorite = useCallback(
    (productId: string) => {
      const wasFavorite = useFavorites.getState().productIds.includes(productId);
      // Optimistic local flip (instant UX; works for guests).
      toggleLocal(productId);

      void (async () => {
        try {
          if (wasFavorite) {
            await api.removeFavorite(productId);
          } else {
            await api.addFavorite(productId);
          }
          // Phase 10 feedback only for the ADD direction; removal is silent
          // (undo-style: the user can just tap the heart again).
          if (!wasFavorite) toast.success(t.addedToFavorites);
        } catch {
          // Roll the optimistic flip back so local state matches the account.
          // (Guests never reach here — there is no request to fail.)
          toggleLocal(productId);
          toast.error(t.favoriteNotAvailable);
        }
      })();
    },
    [toggleLocal, t.addedToFavorites, t.favoriteNotAvailable]
  );

  return { isFavorite, toggleFavorite };
}
