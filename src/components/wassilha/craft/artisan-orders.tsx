'use client';

import { useEffect, useState } from 'react';
import { Check, X, Clock, Package, Loader2, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '../skeleton';
import type { CraftOrderPublic, CraftOrderStatus } from '@/lib/types';

// HIRFA (P6): artisan order management. Lists orders for the artisan's
// shop with status-aware action buttons (accept / reject / mark ready).
export function ArtisanOrders() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<CraftOrderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getCraftOrders()
      .then((res) => setOrders(res.orders))
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: CraftOrderStatus) => {
    setActing(id);
    try {
      await api.updateCraftOrderStatus(id, status);
      toast.success(status === 'confirmed' ? t.acceptOrder : status === 'cancelled' ? t.orderCancelled : status === 'ready' ? t.markReady : t.markDelivered);
      load();
    } catch {
      toast.error(isAr ? 'فشل تحديث الطلب' : 'Échec de la mise à jour');
    } finally {
      setActing(null);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300';
      case 'confirmed': return 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300';
      case 'ready': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300';
      case 'delivered': return 'bg-green-100 text-green-800 dark:bg-green-950/70 dark:text-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return isAr ? 'قيد الانتظار' : 'En attente';
      case 'confirmed': return isAr ? 'مؤكد' : 'Confirmé';
      case 'ready': return isAr ? 'جاهز' : 'Prêt';
      case 'delivered': return isAr ? 'تم التسليم' : 'Livré';
      case 'cancelled': return isAr ? 'ملغى' : 'Annulé';
      default: return status;
    }
  };

  if (loading) {
    return (<div className="space-y-3"><ListSkeleton count={3} /></div>);
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package size={48} className="text-muted-foreground/30" />
        <p className="mt-4 text-sm text-muted-foreground">{isAr ? 'لا توجد طلبات بعد' : 'Aucune commande pour le moment'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground">
        <Clock size={18} className="text-primary" />
        {t.newOrder}
      </h2>

      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{order.code}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ')}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor(order.status)}`}>
                {statusLabel(order.status)}
              </span>
            </div>

            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs font-bold text-foreground">{t.customerName}: {order.customer.name}</p>
              <p className="text-xs text-muted-foreground" dir="ltr">📞 {order.customer.phone}</p>
            </div>

            <div className="space-y-1.5">
              {order.items.map((item) => {
                const name = isAr ? item.product.nameAr : item.product.nameFr || item.product.nameAr;
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-foreground">
                      {item.product.images?.[0] ? (
                        <img src={item.product.images[0]} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <ShoppingBag size={14} className="text-muted-foreground" />
                      )}
                      {name} <span className="text-muted-foreground">×{item.quantity}</span>
                    </span>
                    <span className="font-bold text-foreground">{item.unitPrice * item.quantity} {t.currencyDzd}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs font-bold text-foreground">{t.total}</span>
              <span className="text-sm font-black text-primary">{order.totalPrice} {t.currencyDzd}</span>
            </div>

            {order.status === 'pending' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => updateStatus(order.id, 'confirmed')}
                  disabled={acting === order.id}
                  className="flex-1 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  {acting === order.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} className="me-1" />}
                  {t.acceptOrder}
                </Button>
                <Button
                  onClick={() => updateStatus(order.id, 'cancelled')}
                  disabled={acting === order.id}
                  variant="outline"
                  className="flex-1 rounded-xl border-red-200 text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  <X size={14} className="me-1" />
                  {t.rejectOrder}
                </Button>
              </div>
            )}

            {order.status === 'confirmed' && (
              <Button
                onClick={() => updateStatus(order.id, 'ready')}
                disabled={acting === order.id}
                className="w-full rounded-xl bg-sky-600 text-xs font-bold text-white hover:bg-sky-700"
              >
                {acting === order.id ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} className="me-1" />}
                {t.markReady}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
