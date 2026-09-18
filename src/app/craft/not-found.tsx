// HIRFA Phase 1 — friendly 404 for the public marketplace (/craft/*).
import Link from 'next/link';
import { BrandLogo } from '@/components/wassilha/brand-logo';

export default function CraftNotFound() {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <BrandLogo size={48} />
      <p className="mt-6 text-5xl">🧶</p>
      <h1 className="mt-3 text-xl font-black text-foreground">هذا الرابط غير متوفر</h1>
      <p className="mt-1 text-sm text-muted-foreground">قد يكون المتجر أو المنتج قد أُخفي أو تغيّر رابطه.</p>
      <Link
        href="/craft"
        className="mt-6 inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-sm font-black text-primary-foreground shadow-lg transition hover:bg-brand-dark"
      >
        تصفح حِرفة
      </Link>
    </div>
  );
}
