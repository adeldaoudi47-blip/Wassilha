import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * HSTS is only emitted in production: local dev uses http, where
 * HSTS would break the loop. The other four apply in all environments.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation: only same-origin (the app needs it for the map).
  // Camera/microphone: blocked entirely (no video/voice features yet).
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
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
