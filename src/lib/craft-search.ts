// HIRFA Phase 2A — shared search-filter parsing for the public marketplace.
//
// The SAME parsing logic is used by the SSR page (/craft/search) and by the
// public API, so a URL built by the page always reproduces the same result set
// when it is fetched directly (shareable URLs are a hard requirement).
//
// All filters are optional. Empty strings are normalised away so that
// /craft/search?q=  behaves like /craft/search.

export const CRAFT_SORT_OPTIONS = ['latest', 'price_asc', 'price_desc', 'featured'] as const;
export type CraftSort = (typeof CRAFT_SORT_OPTIONS)[number];

export interface CraftSearchFilters {
  q: string;
  category: string; // category SLUG (URL-safe, shareable)
  area: string; // area SLUG
  priceMin: number | null;
  priceMax: number | null;
  sort: CraftSort;
  page: number;
  pageSize: number;
}

export const CRAFT_SEARCH_PAGE_SIZE = 12;

/** Normalise one raw query-string value into the filters shape. */
export function parseCraftSearchFilters(
  sp: Record<string, string | string[] | undefined> | URLSearchParams | undefined,
  pageSize = CRAFT_SEARCH_PAGE_SIZE
): CraftSearchFilters {
  const get = (key: string): string => {
    if (!sp) return '';
    let v: string | string[] | undefined;
    if (sp instanceof URLSearchParams) v = sp.get(key) ?? undefined;
    else v = sp[key];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };

  const q = get('q').trim().slice(0, 100);
  const category = get('category').trim().slice(0, 100);
  const area = get('area').trim().slice(0, 100);
  const rawMin = parseInt(get('priceMin'), 10);
  const rawMax = parseInt(get('priceMax'), 10);
  const sortRaw = get('sort');
  const sort: CraftSort = (CRAFT_SORT_OPTIONS as readonly string[]).includes(sortRaw)
    ? (sortRaw as CraftSort)
    : 'latest';

  const page = Math.max(1, parseInt(get('page'), 10) || 1);

  return {
    q,
    category,
    area,
    // NaN / negative / absurd values are dropped (no fake filters).
    priceMin: Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : null,
    priceMax: Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : null,
    sort,
    page,
    pageSize: Math.min(pageSize, Math.max(1, parseInt(get('pageSize'), 10) || pageSize)),
  };
}

/** True when at least one filter is actually set (used for the "clear" chip). */
export function hasCraftSearchFilters(f: CraftSearchFilters): boolean {
  return Boolean(f.q || f.category || f.area || f.priceMin !== null || f.priceMax !== null || f.sort !== 'latest');
}

/** Serialise filters back to a shareable relative URL (/craft/search?…). */
export function buildCraftSearchUrl(f: Partial<CraftSearchFilters>): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.category) params.set('category', f.category);
  if (f.area) params.set('area', f.area);
  if (f.priceMin !== null && f.priceMin !== undefined) params.set('priceMin', String(f.priceMin));
  if (f.priceMax !== null && f.priceMax !== undefined) params.set('priceMax', String(f.priceMax));
  if (f.sort && f.sort !== 'latest') params.set('sort', f.sort);
  if (f.page && f.page > 1) params.set('page', String(f.page));
  const qs = params.toString();
  return qs ? `/craft/search?${qs}` : '/craft/search';
}
