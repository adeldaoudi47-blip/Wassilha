'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Hammer, Loader2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { ProductCard } from './product-card';
import { ProductDetail } from './product-detail';
import { cn } from '@/lib/utils';
import type { CraftCategoryPublic, CraftProductPublic } from '@/lib/types';

const PAGE_SIZE = 12;

// HIRFA marketplace home (P3): search + category chips + product grid
// with pagination, drilling into a ProductDetail view via local state.
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
  const reqSeq = useRef(0);

  useEffect(() => {
    api.getCraftCategories().then(setCategories).catch(() => undefined);
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
