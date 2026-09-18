import type { Lang } from './types';

/**
 * Resolve the locale for SERVER components (public marketplace pages).
 * Preference: ?lang= query param -> Accept-Language header -> 'ar' (default,
 * sensible for El Guerrara where Arabic is the primary local language).
 */
export function getLocale(
  searchParams?: { lang?: string } | null,
  headers?: Headers
): Lang {
  const q = searchParams?.lang;
  if (q === 'ar' || q === 'fr') return q;
  if (headers) {
    const al = headers.get('accept-language');
    if (al) {
      const first = al.split(',')[0]?.trim().slice(0, 2).toLowerCase();
      if (first === 'fr') return 'fr';
      if (first === 'ar') return 'ar';
    }
  }
  return 'ar';
}
