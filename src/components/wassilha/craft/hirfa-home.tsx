'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Hammer, Loader2, Search, Star, Store } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getStoreUrl } from '@/lib/craft-urls';
import { useT } from '../use-t';
import { ProductCard } from './product-card';
import { ProductDetail } from './product-detail';
import { cn } from '@/lib/utils';
import type {
  CraftCategoryPublic,
  CraftProductPublic,
  PublicStoreTile,
} from '@/lib/types';

const PAGE_SIZE = 12;
// Cap the featured-stores strip: the full list lives on the public /craft page
// (SSR), so the in-app strip is a discovery teaser, not an exhaustive index.
const MAX_STORE_TILES = 10;

// HIRFA marketplace home (P3): search + category chips + product grid
// with pagination, drilling into a ProductDetail view via local state.
// P8: a "featured stores" strip now lives ABOVE the products, because a buyer
// browses by shop first and by item second. Every tile links to the public
// store page /craft/<slug>.
export function HirfaHome() {
  const { t, isAr } = useT();
  const [categories, setCategories] = useState<CraftCategoryPublic[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<CraftProductPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<CraftProductPublic | null>(null);
  const [stores, setStores] = useState<PublicStoreTile[]>([]);
  const reqSeq = useRef(0);

  useEffect(() => {
    api.getCraftCategories().then(setCategories).catch(() => undefined);
    // Public (no-auth) store tiles: active shops only, with their real rating
    // and product count. A failure here must never break product browsing.
    api
      .listMarketplaceStores()
      .then((s) => setStores(s.slice(0, MAX_STORE_TILES)))
      .catch(() => setStores([]));
  }, []);

  // Debounce the search box (350ms after the last keystroke).
  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      const seq = ++reqSeq.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await api.getCraftProducts({
          categoryId: activeCategory ?? undefined,
          q: search || undefined,
          page: targetPage,
          pageSize: PAGE_SIZE,
        });
        if (seq !== reqSeq.current) return;
        setProducts((prev) => (append ? [...prev, ...res.products] : res.products));
        setTotal(res.total);
        setPage(res.page);
        setHasMore(res.hasMore);
      } catch {
        if (seq === reqSeq.current) setError(true);
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [activeCategory, search]
  );

  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  const isFiltering = activeCategory !== null || search !== '';

  if (selected) {
    return <ProductDetail product={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute top-1/2 start-3 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchCraft}
          className="w-full rounded-2xl border border-border bg-card py-2.5 ps-9 pe-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
              activeCategory === null
                ? 'bg-primary text-primary-foreground shadow'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            {t.allCategories}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
                activeCategory === c.id
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'border border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {isAr ? c.nameAr : c.nameFr || c.nameAr}
            </button>
          ))}
        </div>
      )}

      {/* Featured stores (P8): shown only on the unfiltered home so active
          searches stay focused on products. Each tile is a plain link to the
          public store page /craft/<slug>; the full catalogue lives on the
          public /craft page (SSR, indexed). */}
      {!isFiltering && stores.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-foreground">
              <Store size={15} className="text-primary" />
              {t.featuredStores}
            </h2>
            <Link
              href="/craft"
              prefetch={false}
              className="shrink-0 text-[11px] font-bold text-primary underline-offset-2 hover:underline"
            >
              {t.allStores}
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1.5">
            {stores.map((s) => (
              <StoreTile key={s.id} store={s} />
            ))}
          </div>
        </section>
      )}

      {/* Section title */}
      <div className="flex items-center gap-2">
        <Hammer size={16} className="text-primary" />
        <h2 className="text-sm font-extrabold text-foreground">
          {isFiltering ? `${t.results} (${total})` : t.featuredProducts}
        </h2>
      </div>

      {/* Products grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {isAr
              ? 'تعذر تحميل المنتجات'
              : 'Impossible de charger les produits'}
          </p>
          <button
            onClick={() => fetchPage(1, false)}
            className="mt-2 text-xs font-bold text-primary"
          >
            {t.refresh}
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <Hammer size={32} className="mx-auto text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">{t.noCraftProducts}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} onOpen={setSelected} />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => fetchPage(page + 1, true)}
              disabled={loadingMore}
              className="mx-auto flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2 text-xs font-bold text-primary disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              {t.loadMore}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// One shop in the featured-stores strip. Compact, fixed-width, and the whole
// card IS the link (no nested interactive nodes). Shows the store avatar, its
// REAL rating and live product count, and an explicit "visit store" label.
function StoreTile({ store }: { store: PublicStoreTile }) {
  const { t } = useT();
  return (
    <Link
      href={getStoreUrl(store.slug, store.id)}
      prefetch={false}
      className="group flex w-36 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex h-24 items-center justify-center overflow-hidden bg-muted">
        {store.avatarUrl ? (
          <img
            src={store.avatarUrl}
            alt={store.displayName}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <Store size={30} className="text-muted-foreground/40" />
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="truncate text-sm font-bold text-foreground">{store.displayName}</p>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Star size={11} className="fill-amber-400 text-amber-400" />
          <span className="font-bold text-foreground">{store.rating.toFixed(1)}</span>
          <span className="opacity-50">·</span>
          <span className="truncate">{store.productCount}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
          <Store size={11} />
          {t.visitStore}
        </span>
      </div>
    </Link>
  );
}
