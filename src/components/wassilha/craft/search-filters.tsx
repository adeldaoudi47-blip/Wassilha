'use client';

// HIRFA Phase 2A — search filter bar for /craft/search.
//
// The URL is the single source of truth: every change pushes a new query
// string via router.push, so ANY result set can be opened directly and shared
// (no React-only state). The server component re-renders with the new filters.
//
// `q` is debounced (300ms) so typing doesn't navigate per keystroke.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import {
  buildCraftSearchUrl,
  hasCraftSearchFilters,
  type CraftSearchFilters,
} from '@/lib/craft-search';
import type { Lang } from '@/lib/types';

export interface FilterOption {
  slug: string;
  nameAr: string;
  nameFr: string | null;
}

interface SearchFiltersProps {
  initial: CraftSearchFilters;
  categories: FilterOption[];
  areas: FilterOption[];
  lang: 'ar' | 'fr';
}

const DEBOUNCE_MS = 300;

export function SearchFilters({ initial, categories, areas, lang }: SearchFiltersProps) {
  const t = getMarketplaceT(lang);
  const isRtl = lang === 'ar';
  const router = useRouter();
  // `pendingQ` holds the text the user has typed but not yet committed to the
  // URL (debounced). `committedQ` tracks the URL's current q. The input shows
  // the pending edit when there is one, otherwise the URL value.
  const [committedQ, setCommittedQ] = useState(initial.q);
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React's "adjust state when a prop changes" pattern (state, not refs, and
  // during render — never in an effect). If the URL moved (back/forward,
  // pagination, clear, a shared link) and our pending edit was never committed,
  // drop it so the input follows the URL.
  if (initial.q !== committedQ) {
    setCommittedQ(initial.q);
    if (pendingQ !== null && pendingQ !== initial.q) {
      setPendingQ(null);
    }
  }
  const q = pendingQ ?? committedQ;

  const push = (patch: Partial<CraftSearchFilters>) => {
    // Any filter change restarts from page 1 — old pages are meaningless under
    // a new filter set.
    const next: CraftSearchFilters = { ...initial, ...patch, page: 1 };
    router.push(buildCraftSearchUrl(next));
  };

  const onQChange = (value: string) => {
    setPendingQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // The closure captures THIS keystroke's value; earlier timers are cleared,
    // so only the latest keystroke is ever pushed.
    debounceRef.current = setTimeout(() => push({ q: value.trim() }), DEBOUNCE_MS);
  };

  const onClear = () => {
    router.push('/craft/search');
  };

  const selectCls =
    'h-10 w-full rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search
          size={16}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`}
        />
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className={`h-11 w-full rounded-xl border border-border bg-card text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
        />
      </div>

      {/* Filter selects */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={initial.category}
          onChange={(e) => push({ category: e.target.value })}
          aria-label={t.category}
          className={selectCls}
        >
          <option value="">{t.allCategories}</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {isRtl ? c.nameAr : c.nameFr || c.nameAr}
            </option>
          ))}
        </select>

        <select
          value={initial.area}
          onChange={(e) => push({ area: e.target.value })}
          aria-label={t.area}
          className={selectCls}
        >
          <option value="">{t.allAreas}</option>
          {areas.map((a) => (
            <option key={a.slug} value={a.slug}>
              {isRtl ? a.nameAr : a.nameFr || a.nameAr}
            </option>
          ))}
        </select>

        <input
          type="number"
          min={0}
          value={initial.priceMin ?? ''}
          onChange={(e) => push({ priceMin: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder={t.priceMin}
          aria-label={t.priceMin}
          inputMode="numeric"
          className={selectCls}
        />

        <input
          type="number"
          min={0}
          value={initial.priceMax ?? ''}
          onChange={(e) => push({ priceMax: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder={t.priceMax}
          aria-label={t.priceMax}
          inputMode="numeric"
          className={selectCls}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={initial.sort}
          onChange={(e) => push({ sort: e.target.value as CraftSearchFilters['sort'] })}
          aria-label={t.sortBy}
          className={`${selectCls} w-44`}
        >
          <option value="latest">{t.sortLatest}</option>
          <option value="price_asc">{t.sortPriceAsc}</option>
          <option value="price_desc">{t.sortPriceDesc}</option>
          <option value="featured">{t.sortFeatured}</option>
        </select>

        {hasCraftSearchFilters(initial) && (
          <button
            onClick={onClear}
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
            {t.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
