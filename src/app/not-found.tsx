// Root 404 for any URL that does not match a route.
//
// `/craft/*` already has its own branded 404 (app/craft/not-found.tsx); this
// one covers everything else. Without it, a mistyped or stale share link lands
// on Next's default "This page could not be found" screen, which drops the
// brand and gives a first-time visitor no obvious way forward.
import Link from 'next/link';
import { BrandLogo } from '@/components/wassilha/brand-logo';

export default function NotFound() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center"
    >
      <BrandLogo size={48} />
      <p className="mt-6 text-5xl">🧭</p>
      <h1 className="mt-3 text-xl font-black text-foreground">الصفحة غير موجودة</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        ربما تم تغيير الرابط أو حذف الصفحة. يمكنك العودة إلى الرئيسية أو تصفح متجر الحرف.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-sm font-black text-primary-foreground shadow-lg transition hover:bg-brand-dark"
        >
          الصفحة الرئيسية
        </Link>
        <Link
          href="/craft"
          className="inline-flex items-center justify-center rounded-2xl border border-border px-6 py-3 text-sm font-bold text-foreground transition hover:bg-muted"
        >
          متجر الحرف
        </Link>
      </div>
    </div>
  );
}