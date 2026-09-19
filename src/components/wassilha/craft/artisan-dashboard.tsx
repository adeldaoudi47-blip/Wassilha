'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Package, Loader2, Clock, ShoppingBag, Megaphone, Eye, Link2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { useAppStore, useNavStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ListSkeleton } from '../skeleton';
import { ArtisanProductForm } from './artisan-product-form';
import { ArtisanOrders } from './artisan-orders';
import { ArtisanProfileCard } from './artisan-profile-card';
import { ShareButton } from './share-button';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { getStoreAbsoluteUrl } from '@/lib/craft-urls';
import type { CraftProductPublic } from '@/lib/types';
import type { MyStoreInfo, CraftStoreStats } from '@/lib/types';

// HIRFA (P5+P6): artisan dashboard. Lists the artisan's own products with
// add / edit / delete. Also provides an orders tab for managing incoming
// craft orders (P6).
export function ArtisanDashboard() {
  const { t, isAr } = useT();
  const artisanTab = useNavStore((s) => s.artisanTab);
  const setArtisanTab = useNavStore((s) => s.setArtisanTab);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const [products, setProducts] = useState<CraftProductPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CraftProductPublic | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CraftProductPublic | null>(null);

  // Artisan sub-tabs: products | orders
  const [subTab, setSubTab] = useState<'products' | 'orders'>('products');
  // HIRFAA Phase 1: this artisan's public store (for the "متجري" share card).
  const [myStore, setMyStore] = useState<MyStoreInfo | null>(null);
  // HIRFA Phase 2A: REAL store analytics (zeros until the first real visit).
  const [stats, setStats] = useState<CraftStoreStats | null>(null);

  const load = () => {
    setLoading(true);
    api.getMyCraftProducts()
      .then(setProducts)
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
    api.getMyStore().then(setMyStore).catch(() => setMyStore(null));
    api.getMyStoreStats().then(setStats).catch(() => setStats(null));
  };

  useEffect(() => {
    // Initial load: `loading` is already true from useState, so we only
    // resolve promises here (no synchronous setState in the effect body).
    api.getMyCraftProducts()
      .then(setProducts)
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
    api.getMyStore().then(setMyStore).catch(() => setMyStore(null));
    api.getMyStoreStats().then(setStats).catch(() => setStats(null));
  }, []);

  const handleDelete = async (p: CraftProductPublic) => {
    setConfirmDelete(null);
    try {
      await api.deleteCraftProduct(p.id);
      toast.success(t.productDeleted);
      load();
    } catch {
      toast.error(isAr ? 'تعذر حذف المنتج' : 'Suppression impossible');
    }
  };

  // Artisan "حسابي" tab (P8): the store's PUBLIC identity — display name,
  // store avatar, stable public link — with an optional edit form, plus a
  // direct jump into product management. Rendered INSTEAD of the
  // products/orders lists, which live on their own tabs.
  if (artisanTab === 'profile') {
    return (
      <div className="space-y-4">
        {myStore ? (
          <ArtisanProfileCard
            myStore={myStore}
            isAr={isAr}
            onUpdated={setMyStore}
            onManageProducts={() => setArtisanTab('products')}
          />
        ) : (
          <div className="space-y-3">
            <ListSkeleton count={2} />
          </div>
        )}

        {/* ROLE VIEW SWITCH: browse + order like a customer (UI-only). */}
        <Button
          onClick={() => setViewMode('customer')}
          className="w-full bg-primary text-primary-foreground hover:opacity-90"
        >
          <ShoppingBag size={16} className="me-2" /> {t.switchToCustomer}
        </Button>
      </div>
    );
  }

  if (loading && products.length === 0) {
    return (<div className="space-y-3"><ListSkeleton count={3} /></div>);
  }

  if (adding || editing) {
    return (
      <ArtisanProductForm
        product={editing}
        onDone={() => { setAdding(false); setEditing(null); load(); }}
        onCancel={() => { setAdding(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs: products | orders */}
      <div className="flex gap-2">
        <button
          onClick={() => setSubTab('products')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            subTab === 'products'
              ? 'bg-primary text-primary-foreground shadow'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package size={14} />
          {t.myProducts}
        </button>
        <button
          onClick={() => setSubTab('orders')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            subTab === 'orders'
              ? 'bg-primary text-primary-foreground shadow'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock size={14} />
          {t.newOrder}
        </button>
      </div>

      {/* HIRFA Phase 2A — "روّج لمتجرك": the artisan's stable public store link
          with copy / share / WhatsApp, plus REAL view counts underneath.
          Uses the stable slug URL; never regenerated on rename. */}
      {myStore && (
        <PromoteStoreCard myStore={myStore} stats={stats} isAr={isAr} />
      )}

      {/* ROLE VIEW SWITCH (UI-only): browse + order like a customer without
          changing the artisan role in the DB. Reversible from the customer
          profile ("retour au mode artisan"). */}
      <Button
        onClick={() => setViewMode('customer')}
                className="w-full bg-primary text-primary-foreground hover:opacity-90"
      >
        <ShoppingBag size={16} className="me-2" /> {t.switchToCustomer}
      </Button>

      {subTab === 'orders' ? (
        <ArtisanOrders />
      ) : (
        <ProductsView
          products={products}
          loading={loading}
          onAdd={() => setAdding(true)}
          onEdit={setEditing}
          onDelete={setConfirmDelete}
          onReload={load}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          title={t.deleteProductConfirm}
          description={confirmDelete.nameAr}
          confirmLabel={t.rejectArtisan}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

// Extracted products view to keep the main component clean
function ProductsView({
  products,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onReload,
}: {
  products: CraftProductPublic[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (p: CraftProductPublic) => void;
  onDelete: (p: CraftProductPublic) => void;
  onReload: () => void;
}) {
  const { t, isAr } = useT();

  if (loading && products.length === 0) {
    return (<div className="space-y-3"><ListSkeleton count={3} /></div>);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
          <Package size={18} className="text-primary" />
          {t.myProducts}
        </h2>
        <Button
          onClick={onAdd}
          className="h-10 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700"
        >
          <Plus size={15} className="me-1" />
          {t.addProduct}
        </Button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <Package size={32} className="mx-auto text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">{t.noProducts}</p>
          <Button onClick={onAdd} className="mt-3 h-10 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white">
            {t.addProduct}
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {products.map((p) => {
            const name = isAr ? p.nameAr : p.nameFr || p.nameAr;
            return (
              <Card key={p.id} className="flex gap-3 p-3">
                {p.images && p.images.length > 0 ? (
                  <img src={p.images[0]} alt={name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted"><Package size={22} className="text-muted-foreground/40" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{name}</p>
                  <p className="text-xs font-extrabold text-primary">{p.price} {t.currencyDzd}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button onClick={() => onEdit(p)} variant="outline" className="h-9 w-9 !p-0 rounded-lg text-sky-600" title={t.editProduct}><Pencil size={15} /></Button>
                  <Button onClick={() => onDelete(p)} variant="outline" className="h-9 w-9 !p-0 rounded-lg text-red-600" title={t.deleteProductConfirm}><Trash2 size={15} /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// HIRFA Phase 2A — "روّج لمتجرك" marketing block + real store statistics.
//
// Deliberately placed ABOVE the products/orders tabs but kept compact: the
// seller's first priorities (add product / see orders / share the store) stay
// untouched. Every number shown comes from CraftAnalyticsEvent via
// /api/craft/artisan/me/stats — never invented. A fresh store shows zeros.
function PromoteStoreCard({
  myStore,
  stats,
  isAr,
}: {
  myStore: MyStoreInfo;
  stats: CraftStoreStats | null;
  isAr: boolean;
}) {
  const t = getMarketplaceT(isAr ? 'ar' : 'fr');
  const absoluteUrl = getStoreAbsoluteUrl(myStore.slug, myStore.id);
  const shareText = isAr
    ? `شوفوا متجري في ركن حرفة 👇`
    : `Découvrez ma boutique sur WASSILHA 👇`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${absoluteUrl}`)}`;

  const onCopy = async () => {
    // Anonymous copy_link event (PII-free). Fire and forget.
    api.trackCraftEvent({ type: 'copy_link', storeId: myStore.id }).catch(() => {});
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      toast.success(t.linkCopied);
    } catch {
      window.prompt(isAr ? 'رابط متجرك' : 'Lien de votre boutique', absoluteUrl);
    }
  };

  const statCells: { icon: string; label: string; value: number | null }[] = [
    { icon: '👁️', label: t.statStoreViews, value: stats?.storeViews ?? null },
    { icon: '🛍️', label: t.statProductViews, value: stats?.productViews ?? null },
    { icon: '📤', label: t.statShares, value: stats?.shares ?? null },
    { icon: '🔗', label: t.statCopies, value: stats?.copies ?? null },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Megaphone size={16} className="text-primary" />
        <p className="text-sm font-black text-foreground">{t.promoteYourStore}</p>
      </div>

      {/* Store link + copy */}
      <div dir="ltr" className="mt-2.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-2 text-xs text-primary">
          {absoluteUrl}
        </code>
        <Button
          variant="outline"
          className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-bold"
          onClick={onCopy}
        >
          <Link2 size={14} />
          {t.copyStoreLink}
        </Button>
      </div>

      {/* Share + WhatsApp */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <ShareButton
          lang={isAr ? 'ar' : 'fr'}
          label={t.share}
          analytics={{ storeId: myStore.id }}
          target={{ title: myStore.displayName, text: shareText, url: absoluteUrl }}
        />
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => api.trackCraftEvent({ type: 'share', storeId: myStore.id }).catch(() => {})}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#25D366] px-3 text-xs font-bold text-white transition hover:opacity-90"
        >
          <Share2 size={14} />
          {t.shareOnWhatsApp}
        </a>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{t.promoteHint}</p>

      {/* Real statistics (or zeros) */}
      <div className="mt-3 border-t border-border/60 pt-3">
        <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-muted-foreground">
          {t.storeStats}
        </p>
        <div className="grid grid-cols-4 gap-2">
          {statCells.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-border bg-card/60 p-2 text-center"
              title={c.label}
            >
              <div className="text-base leading-none">{c.icon}</div>
              <div className="mt-1 text-sm font-black text-foreground">
                {/* While loading (stats === null) we show nothing rather than a
                    fake 0; null → "–". Once loaded, 0 is shown as 0. */}
                {c.value === null ? '–' : c.value}
              </div>
              <div className="mt-0.5 text-[9px] font-semibold leading-tight text-muted-foreground">
                {c.label}
              </div>
            </div>
          ))}
        </div>
        {stats && stats.storeViews + stats.productViews + stats.shares + stats.copies === 0 ? (
          <p className="mt-2 text-[10px] text-muted-foreground">{t.statsHint}</p>
        ) : null}
      </div>
    </Card>
  );
}

