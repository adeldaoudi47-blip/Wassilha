'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Package, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { useNavStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ListSkeleton } from '../skeleton';
import { ArtisanProductForm } from './artisan-product-form';
import { ArtisanOrders } from './artisan-orders';
import type { CraftProductPublic } from '@/lib/types';

// HIRFA (P5+P6): artisan dashboard. Lists the artisan's own products with
// add / edit / delete. Also provides an orders tab for managing incoming
// craft orders (P6).
export function ArtisanDashboard() {
  const { t, isAr } = useT();
  const artisanTab = useNavStore((s) => s.artisanTab);
  const setArtisanTab = useNavStore((s) => s.setArtisanTab);
  const [products, setProducts] = useState<CraftProductPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CraftProductPublic | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CraftProductPublic | null>(null);

  // Artisan sub-tabs: products | orders
  const [subTab, setSubTab] = useState<'products' | 'orders'>('products');

  const load = () => {
    setLoading(true);
    api.getMyCraftProducts()
      .then(setProducts)
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
