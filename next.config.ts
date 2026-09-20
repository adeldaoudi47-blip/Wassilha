import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * HSTS is only emitted in production: local dev uses http, where
 * HSTS would break the loop. The other four apply in all environments.
 */
const isProd = process.env.NODE_ENV === 'production';

// C7: Content-Security-Policy. Every directive below was derived from the
// hosts this app actually talks to (grep for https:// in src/):
//   - map tiles ........ https://*.tile.openstreetmap.org
//   - leaflet icons .... raw.githubusercontent.com , unpkg.com
//   - OSRM routing ..... router.project-osrm.org , routing.openstreetmap.de
//   - blob uploads/view  *.vercel-storage.com
//   - realtime socket .. ws:// wss:// (driver live tracking)
// `script-src` must keep 'unsafe-inline': Next.js (App Router) injects
// inline <script> RSC-bootstrap payloads, and src/app/layout.tsx ships
// one inline script that unregisters the legacy service worker. Moving to
// a nonce-based CSP (middleware + x-nonce) is the documented follow-up.
// Dev additionally gets 'unsafe-eval' (Next dev runtime / HMR).
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  'img-src \'self\' data: blob: https://*.tile.openstreetmap.org https://raw.githubusercontent.com https://unpkg.com https://*.vercel-storage.com https://*.public.blob.vercel-storage.com',
  "font-src 'self' data:",
  'connect-src \'self\' https://router.project-osrm.org https://routing.openstreetmap.de https://*.vercel-storage.com https://*.public.blob.vercel-storage.com ws: wss:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation: only same-origin (the app needs it for the map).
  // Camera/microphone: blocked entirely (no video/voice features yet).
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
  // C7: blocks external script/object/base/form/frame-ancestors abuse.
  { key: 'Content-Security-Policy', value: cspDirectives },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    // C7: build-time type-checking re-enabled. It was disabled while the
    // Prisma schema and DTO types were still in flux; with the schema
    // settled and `tsc --noEmit` clean, leaving this on masked real type
    // regressions that could reach production silently.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // HIRFA Phase 1: product/store images are served from Vercel Blob.
  // Without this, `next/image` throws "hostname is not configured" and the
  // public marketplace pages (/craft) SSR-crash with a 500.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.vercel-storage.com" },
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
