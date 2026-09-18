// HIRFA Phase 1 — public cart page (/craft/cart).
// Reuses the EXISTING CraftCart client component + useCraftCart store —
// no auth required, no cart redesign (Phase 1 constraint).
import { getLocale } from '@/lib/locale';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import Link from 'next/link';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { LangToggle } from '@/components/wassilha/lang-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CraftCart } from '@/components/wassilha/craft/craft-cart';

export const metadata = {
  title: 'سلة المشتريات · وَصِّلها',
  robots: { index: false, follow: false },
};

export default async function CraftCartPage({
  searchParams,
}: {
  searchParams?: Promise<{ lang?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const lang = getLocale(sp) as 'ar' | 'fr';
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/craft" aria-label="WASSILHA">
            <BrandLogo size={36} />
          </Link>
          <div className="min-w-0 flex-1" />
          <ThemeToggle />
          <LangToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <CraftCart />
      </main>
    </div>
  );
}
