import type { Metadata } from 'next';
import { HomeShell } from '@/components/wassilha/home-shell';
import { SITE_URL } from '@/lib/site';

// The root route is a SERVER COMPONENT so the crawler-facing metadata is
// emitted as real <head> tags and the landing copy is part of the first HTML
// payload. All interactive behaviour lives in <HomeShell /> (a client
// component) — see landing-page.tsx for why client components are still
// server-rendered here.

const TITLE_AR =
  'وَصِّلها · WASSILHA — نقل بضائعك بثقة في القرارة | توصيل، تكسي، سوق حِرفة';
const TITLE_FR =
  'Wassilha — livraison de marchandises à El Guerrara | Triporteur, taxi, artisanat';
const DESC_AR =
  'وَصِّلها: منصة نقل البضائع بالدراجة ثلاثية العجلات (Triporteur) في غرداية والقرارة — الجزائر. اطلب التوصيل، احجز تكسي، أو تسوّق منتجات الحرف اليدوية من سوق حِرفة. تتبع مباشر وأسعار واضحة.';
const DESC_FR =
  'Wassilha : plateforme de livraison de marchandises en triporteur à El Guerrara et Guerrara, Algérie. Commandez une livraison, réservez un taxi, ou achetez des produits artisanaux. Suivi en direct, tarifs clairs.';

export const metadata: Metadata = {
  // Absolute origin for canonical URLs, OG images and sitemap entries.
  // Falls back to https://wassilha.vercel.app when no env var is set.
  metadataBase: new URL(SITE_URL),
  title: TITLE_AR,
  description: DESC_AR,
  keywords: [
    'WASSILHA',
    'وَصِّلها',
    'توصيل',
    'Triporteur',
    'نقل البضائع',
    'القرارة',
    'غرداية',
    'Ghardaïa',
    'El Guerrara',
    'الجزائر',
    'delivery',
    'taxi',
    'سوق الحرف',
  ],
  authors: [{ name: 'WASSILHA' }],
  creator: 'WASSILHA',
  alternates: {
    // Self-referential canonical. There is one URL per language (the language
    // is a client-side preference, not a separate route), so the alternates
    // point at the same path with the correct hreflang codes.
    canonical: '/',
    languages: {
      'ar-DZ': '/',
      'fr-DZ': '/',
      'x-default': '/',
    },
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'WASSILHA',
    locale: 'ar_DZ',
    alternateLocale: ['fr_DZ'],
    title: TITLE_AR,
    description: DESC_AR,
    images: [
      { url: '/icon-512.png', width: 512, height: 512, alt: 'WASSILHA — وَصِّلها' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE_AR,
    description: DESC_AR,
    images: ['/icon-512.png'],
  },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <HomeShell />;
}
