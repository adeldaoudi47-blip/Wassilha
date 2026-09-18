// HIRFA Phase 2A — robots policy (app/robots.ts → /robots.txt).
//
// Allow the public marketplace, storefronts and products. Block every private
// surface: the API (except crawling makes no sense there anyway), the admin
// back-office, and the in-app customer/driver/account views. The whole SPA
// shell under "/" is allowed only so the root domain resolves.
//
// This route takes precedence over any static file; the legacy
// public/robots.txt (which allowed everything) was removed for this reason.
import type { MetadataRoute } from 'next';
import { SITE_URL, absoluteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/craft',
          '/craft/',
          '/privacy-policy',
        ],
        disallow: [
          '/api/',
          '/admin',
          '/dashboard',
          '/track',
          '/orders',
          '/profile',
          '/settings',
          // The guest cart is functional, not content: no reason to index it.
          '/craft/cart',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  };
}
