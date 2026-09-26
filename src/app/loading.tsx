// Route-level loading UI.
//
// Shown while a route's server components suspend. On this app that mainly
// affects the public /craft pages (they query Prisma for stores/products) and
// the very first paint before `page.tsx` finishes restoring the session.
//
// It is intentionally a branded splash rather than a spinner: the shell
// already shows a `WASSILHA` boot spinner for the SPA session restore, so
// reusing the brand here keeps the two moments feeling like one product
// instead of two unrelated states.
import { BrandLogo } from '@/components/wassilha/brand-logo';

export default function Loading() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-primary"
    >
      <BrandLogo size={48} variant="light" />
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <p className="text-sm font-semibold text-white/80">جارٍ التحميل…</p>
    </div>
  );
}