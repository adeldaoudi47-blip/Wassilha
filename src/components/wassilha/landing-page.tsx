'use client';

// SEO / first-impression landing page for anonymous visitors.
//
// WHY THIS IS A CLIENT COMPONENT (it looks like it contradicts the "SSR
// landing" goal, but it does not): in the App Router, client components are
// STILL rendered to HTML on the server and then hydrated. Google and every
// link preview read that HTML exactly as they would for a server component.
// What made the OLD root page invisible to crawlers was never the
// `'use client'` directive — it was that the first paint was a bare boot
// spinner, with all real content produced only after a `useEffect` session
// check. This component is rendered unconditionally in the initial payload
// (see home-shell.tsx), so the <h1> and the service copy below are present in
// the very first bytes of HTML, before any JavaScript runs.
//
// It is a client component only so the primary call-to-action can hand control
// back to the auth flow, which is client state (there is no /login route).
// Every string below is static and bilingual so both language alternates
// declared in the page metadata point at real, translated content.
import Link from 'next/link';
import { Package, Car, Store, ArrowLeft, ShieldCheck, Clock, MapPin } from 'lucide-react';
import { BrandLogo } from '@/components/wassilha/brand-logo';
import { useT } from '@/components/wassilha/use-t';

// Index-aligned icon lists: SERVICE_ICONS[i] renders the icon for
// c.services[i], TRUST_ICONS picks by the `icon` key carried in each copy row.
const SERVICE_ICONS = [Package, Car, Store] as const;
const TRUST_ICONS = { shield: ShieldCheck, clock: Clock, map: MapPin } as const;

const COPY = {
  ar: {
    heroTitle: 'وَصِّلها — نقل بضائعك بثقة في القرارة',
    heroSubtitle:
      'منصة جزائرية لنقل البضائع بالدراجة ثلاثية العجلات (Triporteur) داخل غرداية وقرارة. اطلب في أقل من دقيقة، تابع طلبك لحظة بلحظة، وادفع بأمان.',
    ctaPrimary: 'ابدأ التوصيل',
    ctaSecondary: 'تصفح سوق حِرفة',
    servicesTitle: 'ثلاث خدمات في تطبيق واحد',
    servicesSubtitle:
      'سواء أردت نقل أثاث، أو حجز سيارة أجرة، أو شراء منتج من حرفي محلي — وَصِّلها تغطي الجميع.',
    services: [
      {
        title: 'توصيل البضائع',
        body: 'نقل الأثاث، الأجهزة، مواد البناء والطرود داخل أحياء القرارة الـ 41. اختر نقطة الانطلاق والوجهة، والسائق يصل إليك في أقرب وقت.',
      },
      {
        title: 'تكسي',
        body: 'حجز سيارة أجرة خاصة للرحلات الفردية. حدّد موقعك، اختر نوع الرحلة، وتابع السائق حتى الوصول.',
      },
      {
        title: 'سوق حِرفة',
        body: 'متجر للحرف اليدوية المحلية: منتجات مصنوعة يدوياً من حرفيين في منطقتك، مع الطلب والتوصيل من نفس التطبيق.',
      },
    ],
    stepsTitle: 'كيف يعمل؟',
    steps: [
      { title: 'أنشئ حسابك', body: 'رقم هاتفك يكفي — لا كلمة مرور ولا تعقيد.' },
      { title: 'أرسل طلبك', body: 'حدّد نوع الخدمة، النقاط، والموعد المناسب.' },
      { title: 'تابع وتأكيد', body: 'تتبع مباشر لسائقك حتى التسليم.' },
    ],
    trustTitle: 'لماذا وَصِّلها؟',
    trust: [
      { icon: 'shield', title: 'سائقون موثّقون', body: 'كل سائق يمرّ بتحقّق من الهوية والوثائق قبل العمل.' },
      { icon: 'clock', title: 'تتبع مباشر', body: 'تعرف مكان سائقك ووقت وصوله المتوقع في كل لحظة.' },
      { icon: 'map', title: 'تغطية محلية', body: 'نغطي أحياء القرارة بالكامل بدل التوصيل العشوائي.' },
    ],
    closingTitle: 'جاهز لأول طلب؟',
    closingBody: 'ابدأ الآن مباشرة من المتصفح — لا حاجة لتحميل التطبيق.',
  },
  fr: {
    heroTitle: 'Wassilha — livrez vos marchandises en toute confiance à El Guerrara',
    heroSubtitle:
      'Plateforme algérienne de transport de marchandises en triporteur, à El Guerrara et Guerrara. Commandez en moins d’une minute, suivez votre livraison en direct, payez en toute sécurité.',
    ctaPrimary: 'Commencer la livraison',
    ctaSecondary: 'Voir le marché de l’artisanat',
    servicesTitle: 'Trois services dans une seule application',
    servicesSubtitle:
      'Que vous vouliez transporter un meuble, réserver un taxi, ou acheter un produit artisanal local, Wassilha vous couvre.',
    services: [
      {
        title: 'Livraison de marchandises',
        body: 'Meubles, électroménager, matériaux de construction et colis dans les 41 quartiers d’El Guerrara. Choisissez le point de départ et la destination, le chauffeur arrive rapidement.',
      },
      {
        title: 'Taxi',
        body: 'Réservez une voiture privée pour vos trajets. Indiquez votre position, choisissez le type de trajet et suivez le chauffeur jusqu’à l’arrivée.',
      },
      {
        title: 'Marché de l’artisanat',
        body: 'Une boutique d’artisanat local : produits fabriqués à la main par des artisans de votre région, avec commande et livraison depuis la même application.',
      },
    ],
    stepsTitle: 'Comment ça marche ?',
    steps: [
      { title: 'Créez votre compte', body: 'Votre numéro suffit — pas de mot de passe.' },
      { title: 'Envoyez votre demande', body: 'Type de service, points de prise en charge et horaire.' },
      { title: 'Suivez et confirmez', body: 'Suivi direct du chauffeur jusqu’à la livraison.' },
    ],
    trustTitle: 'Pourquoi Wassilha ?',
    trust: [
      { icon: 'shield', title: 'Chauffeurs vérifiés', body: 'Chaque chauffeur passe par une vérification d’identité avant de travailler.' },
      { icon: 'clock', title: 'Suivi en direct', body: 'Vous voyez la position du chauffeur et l’heure d’arrivée estimée.' },
      { icon: 'map', title: 'Couverture locale', body: 'Nous couvrons tous les quartiers de Guerrara, pas seulement du hasard.' },
    ],
    closingTitle: 'Prêt pour votre première commande ?',
    closingBody: 'Commencez directement dans le navigateur — aucune installation requise.',
  },
} as const;

export function LandingPage({ onStart }: { onStart: () => void }) {
  const { isAr, isRtl, toggle } = useT();
  const c = isAr ? COPY.ar : COPY.fr;
  const dir = isRtl ? 'rtl' : 'ltr';

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Language switcher — the page ships in both languages, so give the
          visitor a direct way to move between the two declared alternates. */}
      <div className="flex justify-end px-5 pt-5">
        <button
          onClick={toggle}
          className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-muted"
        >
          {isAr ? 'Français' : 'العربية'}
        </button>
      </div>

      {/* HERO — the <h1> search engines read. */}
      <section className="mx-auto max-w-4xl px-5 pb-10 pt-8 text-center">
        <div className="flex justify-center">
          <BrandLogo size={64} showText />
        </div>
        <h1 className="mx-auto mt-7 text-3xl font-black leading-tight text-foreground sm:text-4xl">
          {c.heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {c.heroSubtitle}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-7 py-3.5 text-sm font-black text-primary-foreground shadow-lg transition hover:bg-brand-dark"
          >
            {c.ctaPrimary}
            <ArrowLeft size={16} className={isRtl ? '' : 'rotate-180'} />
          </button>
          <Link
            href="/craft"
            className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-7 py-3.5 text-sm font-black text-foreground transition hover:bg-muted"
          >
            <Store size={16} />
            {c.ctaSecondary}
          </Link>
        </div>
      </section>

      {/* SERVICES — the bulk of the indexable body copy. */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        <h2 className="text-center text-2xl font-black">{c.servicesTitle}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
          {c.servicesSubtitle}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {c.services.map((s, i) => {
            const Icon = SERVICE_ICONS[i];
            return (
              <article
                key={s.title}
                className="rounded-2xl border border-border bg-card p-6 text-start shadow-sm"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={22} />
                </div>
                <h3 className="mt-4 text-base font-black">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-muted/40 py-12">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="text-center text-2xl font-black">{c.stepsTitle}</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {c.steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-card p-6 text-start shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-black">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TRUST */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        <h2 className="text-center text-2xl font-black">{c.trustTitle}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {c.trust.map((t) => {
            const Icon = TRUST_ICONS[t.icon as keyof typeof TRUST_ICONS];
            return (
              <div
                key={t.title}
                className="flex gap-3 rounded-2xl border border-border bg-card p-5 text-start"
              >
                <Icon size={20} className="mt-0.5 shrink-0 text-primary" />
                <div>
                  <h3 className="text-sm font-black">{t.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="bg-primary py-14 text-center">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="text-2xl font-black text-primary-foreground">
            {c.closingTitle}
          </h2>
          <p className="mt-2 text-sm text-white/80">{c.closingBody}</p>
          <button
            onClick={onStart}
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-sm font-black text-primary transition hover:bg-white/90"
          >
            {c.ctaPrimary}
          </button>
        </div>
      </section>
    </div>
  );
}


