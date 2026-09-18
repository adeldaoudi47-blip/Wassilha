// Absolute origin used to build canonical URLs + OG tags on public pages.
// Reads NEXT_PUBLIC_SITE_URL / SITE_URL (per-environment); falls back to the
// production Vercel domain so every share link is absolute & clickable.
export const SITE_URL: string =
  (typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL)) ||
  'https://wassilha.vercel.app';

export function absoluteUrl(path: string): string {
  const base = SITE_URL.endsWith('/') ? SITE_URL.slice(0, -1) : SITE_URL;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
