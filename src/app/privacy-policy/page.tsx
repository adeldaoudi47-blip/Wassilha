// Privacy Policy page for the Wassilha app.
//
// Required by the Google Play Store data-safety review, and a
// good baseline for any privacy regulator. The content here is an
// authoritative statement of what the service does; if the product
// changes (new data collection, new sharing, new providers) the
// text below must be updated and the version date bumped.
//
// Rendered as a Server Component (no client state, no interactivity).
// Fully static — fits the i18n surface with hard-coded Arabic plus a
// mirrored French section for the bilingual Algerian market.
//
// The route URL is /privacy-policy — it is linked from the customer
// and driver profile footers.
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — وصّلها',
  description:
    'سياسة الخصوصية لتطبيق وصّلها: ما البيانات التي نجمعها، كيف نستخدمها، كيف نحميها، وحقوق المستخدم.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/privacy-policy' },
};

// A single source of truth for the last-updated date. Bumped whenever
// the policy text changes; also displayed at the top of the page.
const LAST_UPDATED_AR = '15 يناير 2026';
const LAST_UPDATED_FR = '15 janvier 2026';

type Section = {
  id: string;
  title: string;
  body: string[];
};

const AR_SECTIONS: Section[] = [
  {
    id: 'intro',
    title: '١. مقدمة',
    body: [
      'في تطبيق "وصّلها"، نحترم خصوصية مستخدمينا ونتعامل مع بياناتهم بكل عناية ومسؤولية. توضح هذه السياسة ماهية البيانات التي نجمعها، وكيف نستخدمها، ومن نشاركها معه، وكيف نحميها.',
      'باستخدامك لتطبيق وصّلها فإنك توافق على الممارسات الموضحة في هذه السياسة. إذا كنت لا توافق على أي بند من بنودها، يُرجى التوقف عن استخدام التطبيق.',
    ],
  },
  {
    id: 'data',
    title: '٢. البيانات التي نجمعها',
    body: [
      'نجمع الحد الأدنى من البيانات اللازمة لتشغيل خدمة التوصيل بأمان وموثوقية، وتشمل:',
      '• رقم الهاتف: يُستخدم لمرة واحدة للتحقق من هويتك عبر رمز (OTP) عند تسجيل الدخول أو عند نسيان كلمة المرور. لا يُستخدم لأي غرض تسويقي.',
      '• الاسم الكامل: يُطلب من السائقين لإثبات هويتهم، ومن الزبائن لتسهيل التواصل خلال تنفيذ الطلب.',
      '• الموقع الجغرافي (GPS): يُجمع من السائقين فقط أثناء فترة الخدمة لتحديد موقعهم على الخريطة وإيصال الزبون إلى أقرب سائق متاح. لا يُجمع من الزبائن بشكل مستمر، بل فقط أثناء تنفيذ طلب نشط.',
      '• بيانات المركبة والبطاقة الرمادية: يرفقها السائقون عند التقديم على الانضمام إلى المنصة، وتُستخدم للتحقق من ملكية المركبة وصلاحيتها قبل تفعيل الحساب.',
      '• بيانات الرحلات: نقاط الانطلاق والوصول، التوقيت، حالة الطلب، التقييمات، وملاحظات السائق والزبون.',
    ],
  },
  {
    id: 'usage',
    title: '٣. كيف نستخدم البيانات',
    body: [
      'نستخدم البيانات التي نجمعها للأغراض التالية فقط:',
      '• ربط الزبائن بالسائقين الأقرب إليهم جغرافياً لتنفيذ طلبات التوصيل.',
      '• حساب الأسعار وإصدار إيصالات الطلبات بدقة.',
      '• إرسال إشعارات داخل التطبيق تتعلق بحالة الطلب (القبول، الانطلاق، الوصول، التسليم).',
      '• تحسين جودة الخدمة من خلال تحليل أوقات الاستجابة، وتقييمات السائقين، ومدى تكرار الطلبات.',
      '• التحقيق في الشكاوى والنزاعات وحماية مستخدمينا من السلوك المسيء.',
      '• لا نستخدم بياناتك في الإعلانات الموجّهة، ولا نُشاركها مع أطراف ثالثة لتسويق منتجاتها لك.',
    ],
  },
  {
    id: 'sharing',
    title: '٤. مشاركة البيانات',
    body: [
      'نلتزم بعدم بيع أو تأجير أو مشاركة بياناتك الشخصية مع أي طرف ثالث لأغراض تسويقية.',
      'قد نُشارك الحد الأدنى من البيانات في الحالات التالية فقط:',
      '• مع السائق أو الزبون الآخر المعني بنفس الطلب: يتبادل الطرفان الاسم ورقم الهاتف فقط في حدود ما يحتاجانه لإتمام التسليم.',
      '• مع مزوّدي الخدمات التقنيين (الاستضافة، قاعدة البيانات، إرسال الرسائل القصيرة وواتساب): يلتزمون بعقود سرية ولا يحق لهم استخدام البيانات لأي غرض آخر.',
      '• مع جهات إنفاذ القانون أو السلطات القضائية: فقط إذا طُلب منا ذلك بموجب أمر قضائي أو قانوني ملزم، وفي حدود ما يطلبه القانون بالضبط.',
    ],
  },
  {
    id: 'security',
    title: '٥. حماية البيانات',
    body: [
      'نطبّق إجراءات تقنية وإدارية صارمة لحماية بياناتك من الوصول غير المصرّح به أو الفقدان أو التغيير أو التسريب:',
      '• كلمات المرور لا تُخزَّن بنص صريح أبداً، بل تُحفظ بعد تجزئتها (Hashing) باستخدام خوارزميات حديثة وآمنة.',
      '• جلسات الدخول (Session Cookies) موقّعة ومُشفّرة، وتُبطل تلقائياً عند تسجيل الخروج أو عند تعليق الحساب من قِبَل الإدارة.',
      '• قنوات الاتصال بين التطبيق والخادم محمية بتشفير HTTPS / TLS.',
      '• الوصول إلى بيانات قاعدة البيانات محدود بأقل عدد ممكن من الأشخاص، وكل عملية وصول تُسجَّل للمراجعة.',
      '• معاملات قاعدة البيانات الحساسة (مثل تعليق الحساب أو حذفه) تتم بشكل ذرّي (transactional) حتى لا تترك أي بيانات متضاربة.',
    ],
  },
  {
    id: 'rights',
    title: '٦. حقوق المستخدم',
    body: [
      'لك كامل الحق في ممارسة الإجراءات التالية في أي وقت:',
      '• حق الوصول: يمكنك طلب نسخة من بياناتك الشخصية المخزّنة لدينا.',
      '• حق التصحيح: يمكنك تعديل اسمك أو بياناتك من داخل التطبيق أو بطلب من الإدارة.',
      '• حق الحذف: يمكنك طلب حذف حسابك وجميع بياناتك المرتبطة به نهائياً بالتواصل مع الإدارة على البريد الإلكتروني المذكور أدناه. سنقوم بالحذف خلال مدة أقصاها 30 يوماً، مع الإبقاء على السجلات المالية والقانونية التي يَلزمنا الاحتفاظ بها بمقتضى القانون.',
      '• حق الاعتراض: يمكنك الاعتراض على أي معالجة لبياناتك تتجاوز الأغراض المذكورة أعلاه.',
      '• حق إيقاف الإشعارات: يمكنك إيقاف إشعارات التطبيق من إعدادات هاتفك في أي وقت.',
    ],
  },
  {
    id: 'contact',
    title: '٧. التواصل',
    body: [
      'للاستفسارات المتعلقة بالخصوصية أو لممارسة أي من حقوقك المذكورة أعلاه، يُرجى التواصل معنا عبر:',
      '• البريد الإلكتروني: daoudiadil0@gmail.com',
      '• داخل التطبيق: من خلال قسم المساعدة في الإعدادات.',
      'سنردّ على طلبك خلال مدة أقصاها 7 أيام عمل.',
    ],
  },
  {
    id: 'changes',
    title: '٨. التحديثات على هذه السياسة',
    body: [
      'قد نقوم بتحديث هذه السياسة من وقتٍ آخر لتعكس التغييرات في ممارساتنا أو في متطلبات القوانين المعمول بها. سنُخطرك بالتغييرات الجوهرية عبر إشعار داخل التطبيق، ويصبح أي تعديل سارياً من تاريخ نشره على هذه الصفحة.',
      'نسخة هذه السياسة محدّثة بتاريخ: 15 يناير 2026.',
    ],
  },
];


// French mirror. Concise on purpose — the canonical document is the
// Arabic one (Algeria: AR is the first-priority language). The French
// section lets francophone users and Google Play reviewers confirm the
// same commitments in their working language.
const FR_INTRO =
  "Wassilha (« nous ») respecte la vie privée de ses utilisateurs. " +
  "La présente politique décrit les données que nous collectons, l'usage " +
  "que nous en faisons, avec qui nous les partageons et comment nous les " +
  "protégeons. En utilisant l'application, vous acceptez ces pratiques.";

const FR_SECTIONS: Section[] = [
  {
    id: 'data',
    title: '1. Données collectées',
    body: [
      'Numéro de téléphone (authentification par OTP), nom complet, géolocalisation GPS des chauffeurs pendant le service, données du véhicule et de la carte grise pour vérification, et données de course (trajet, horaires, évaluation).',
    ],
  },
  {
    id: 'usage',
    title: '2. Utilisation',
    body: [
      "Mise en relation client-chauffeur, calcul du prix, notifications de statut de commande, amélioration de la qualité du service, et résolution des litiges. Aucune utilisation publicitaire ciblée.",
    ],
  },
  {
    id: 'sharing',
    title: '3. Partage',
    body: [
      "Aucune vente ni location de données. Partage limité au chauffeur/client de la même course, aux sous-traitants techniques (hébergement, SMS/WhatsApp) sous accord de confidentialité, et aux autorités sur réquisition légale.",
    ],
  },
  {
    id: 'security',
    title: '4. Sécurité',
    body: [
      "Mots de passe hachés (jamais en clair), sessions signées et chiffrées, HTTPS/TLS, transactions atomiques pour les opérations sensibles, accès à la base de données journalisé et limité.",
    ],
  },
  {
    id: 'rights',
    title: '5. Vos droits',
    body: [
      "Accès, rectification, suppression (sous 30 jours, sauf obligations légales de conservation), opposition au traitement, et désactivation des notifications à tout moment depuis les réglages de votre téléphone.",
    ],
  },
  {
    id: 'contact',
    title: '6. Contact',
    body: [
      "Pour toute demande relative à la vie privée : daoudiadil0@gmail.com. Réponse sous 7 jours ouvrés.",
    ],
  },
  {
    id: 'changes',
    title: '7. Mises à jour',
    body: [
      "Cette politique peut être mise à jour. Toute modification substantielle sera notifiée dans l'application. Dernière mise à jour : 15 janvier 2026.",
    ],
  },
];


export default function PrivacyPolicyPage() {
  return (
    <main
      dir="rtl"
      lang="ar"
      className="min-h-screen bg-gradient-to-b from-background to-muted/30"
    >
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <header className="mb-8 text-center">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
            Wassilha · وصّلها
          </p>
          <h1 className="text-3xl font-black leading-tight text-foreground sm:text-4xl">
            سياسة الخصوصية
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            آخر تحديث: {LAST_UPDATED_AR}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dernière mise à jour : {LAST_UPDATED_FR}
          </p>
        </header>

        {/* Arabic (canonical) */}
        <SectionList sections={AR_SECTIONS} lang="ar" />

        {/* French mirror */}
        <div className="my-12 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            FR
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <section dir="ltr" lang="fr" className="text-start">
          <h2 className="mb-4 text-2xl font-black text-foreground">
            Politique de confidentialité
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
            {FR_INTRO}
          </p>
          <SectionList sections={FR_SECTIONS} lang="fr" />
        </section>

        {/* Footer / back link */}
        <footer className="mt-12 border-t pt-6 text-center">
          <Link
            href="/"
            className="text-sm font-bold text-primary hover:underline"
          >
            ← العودة إلى التطبيق
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">
            © 2026 Wassilha · جميع الحقوق محفوظة
          </p>
        </footer>
      </article>
    </main>
  );
}

function SectionList({
  sections,
  lang,
}: {
  sections: Section[];
  lang: 'ar' | 'fr';
}) {
  const headingClass = lang === 'ar' ? 'text-xl font-black' : 'text-xl font-bold';
  const bodyClass = lang === 'ar' ? 'text-sm leading-loose' : 'text-sm leading-relaxed';
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <h3 className={`mb-3 text-foreground ${headingClass}`}>
            {section.title}
          </h3>
          <div className={`text-muted-foreground ${bodyClass}`}>
            {section.body.map((paragraph, idx) => (
              <p
                key={idx}
                className={
                  paragraph.startsWith('•')
                    ? 'ms-4 mt-1 block'
                    : 'mb-3 block last:mb-0'
                }
              >
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

