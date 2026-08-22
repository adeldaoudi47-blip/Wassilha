'use client';

import { Languages } from 'lucide-react';
import { useT } from './use-t';
import { cn } from '@/lib/utils';

export function LangToggle({ variant = 'default' }: { variant?: 'default' | 'ghost' }) {
  const { lang, setLang, isAr } = useT();
  if (variant === 'ghost') {
    return (
      <button
        onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25"
      >
        <Languages size={15} />
        {lang === 'ar' ? 'FR' : 'ع'}
      </button>
    );
  }
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card p-0.5 shadow-sm">
      <button
        onClick={() => setLang('ar')}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-bold transition',
          isAr ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        العربية
      </button>
      <button
        onClick={() => setLang('fr')}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-bold transition',
          !isAr ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        FR
      </button>
    </div>
  );
}
