// Root error boundary — the LAST line of defence for the whole app.
//
// Before this existed, any unhandled render/server error inside a route that
// has no nearer boundary produced Next.js's default error page, which throws
// away the brand and leaves a guest staring at a blank screen. That is the
// worst possible first impression, and on this app it is reachable: the shell
// renders dozens of screens off a single route (`page.tsx` switches on role +
// tab), so one bad payload can take down the entire experience at once.
//
// This must be a Client Component: `error.tsx` receives a `reset` callback and
// is rendered outside the server tree, so it can never be a Server Component.
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { Button } from '@/components/ui/button';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console so a guest can screenshot it and a
    // support conversation can start from something concrete. There is no
    // error-reporting backend wired up yet, so this log is currently the only
    // place a production failure is recorded.
    console.error('[wassilha] unhandled route error:', error);
  }, [error]);

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      <BrandLogo size={48} />

      <h1 className="text-xl font-black text-foreground">
        حدث خطأ غير متوقع
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        نعتذر عن ذلك. حاول مرة أخرى، وإذا تكرر الأمر تواصل معنا عبر واتساب.
      </p>

      {error.digest ? (
        // Surfaced deliberately: without it, a user can only say "it broke" and
        // the corresponding server log has no matching identifier to search for.
        <p className="font-mono text-[11px] text-muted-foreground/70">
          رمز الخطأ: {error.digest}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button
          onClick={() => reset()}
          className="rounded-2xl px-6 py-3 text-sm font-black"
        >
          إعادة المحاولة
        </Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl border border-border px-6 py-3 text-sm font-bold text-foreground transition hover:bg-muted"
        >
          الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}