// Web app manifest — this is what makes the site installable.
//
// Without a manifest there is no "Add to Home screen" on Android/Chrome and no
// standalone launch on iOS: the app could only ever be reached by opening a
// browser tab, which is the single biggest driver of bounce for a consumer app
// that people are expected to reopen several times a day.
//
// Icons are generated from `src/app/icon.png` (1600x1600) by
// `scripts/generate-icons.mjs`; regenerate them after a brand change:
//   node scripts/generate-icons.mjs
//
// The `maskable` icon is the one that matters most on Android: the OS crops
// whatever it is given to an arbitrary shape (circle, squircle, rounded
// square), so the logo is inset onto a solid brand background and kept well
// inside the 80% safe zone. A plain full-bleed icon gets its corners sliced off
// and looks broken once installed.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WASSILHA — خدمات النقل والتوصيل',
    short_name: 'WASSILHA',
    description:
      'نقل سريع وتوصيل طلبات للحرف اليدوية في غرداية و Guerrara. موثوق، سهل، وآمن.',
    // `start_url` must be the app shell, not "/" of a marketing site: the
    // session restore in `page.tsx` reads from persisted storage, so booting
    // straight into "/" lands the returning user on their role dashboard.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches `themeColor` in app/layout.tsx and the primary brand green.
    background_color: '#0E6B5E',
    theme_color: '#0E6B5E',
    lang: 'ar',
    dir: 'rtl',
    categories: ['travel', 'shopping', 'business', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'متجر الحرف',
        short_name: 'الحرف',
        url: '/craft',
      },
      {
        name: 'تتبع طلبك',
        short_name: 'التتبع',
        url: '/',
      },
    ],
  };
}