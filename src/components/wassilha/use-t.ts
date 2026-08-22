'use client';

import { useAppStore } from '@/lib/store';
import { getT } from '@/lib/i18n';
import type { Translation } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

// Combined hook: language + translation object + isRTL
export function useT(): {
  lang: Lang;
  t: Translation;
  isAr: boolean;
  isRtl: boolean;
  setLang: (l: Lang) => void;
  toggle: () => void;
} {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const t = getT(lang);
  return {
    lang,
    t,
    isAr: lang === 'ar',
    isRtl: lang === 'ar',
    setLang,
    toggle: () => setLang(lang === 'ar' ? 'fr' : 'ar'),
  };
}
