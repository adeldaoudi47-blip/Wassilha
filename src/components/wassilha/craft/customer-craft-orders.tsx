'use client';

import { useEffect, useState } from 'react';
import { Package, Star, ShoppingBag, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '../skeleton';
import { CraftRatingDialog } from './craft-rating-dialog';
import type { CraftOrderPublic } from '@/lib/types';

export function CustomerCraftOrders() {
  const { t, isAr } = useT();
  const [orders, setOrders] = useState<CraftOrderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingOrderId, setRatingOrderId] = useState<string | null>(null);
  const [ratingOrderArtisan, setRatingOrderArtisan] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getCraftOrders().then((res) => setOrders(res.orders)).catch(() => toast.error(t.fetchError)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const statusColor = (s: string) => {
    const colors: Record<string, string> = { pending: 'bg-amber-100 text-amber-800', confirmed: 'bg-sky-100 text-sky-800', ready: 'bg-emerald-100 text-emerald-800', delivered: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800' };
    return colors[s] || 'bg-muted text-muted-foreground';
  };

  const statusLabel = (s: string) => {
    const labels: Record<string, string> = { pending: isAr ? 'قيد الانتظار' : 'En attente', confirmed: isAr ? 'مؤكد' : 'Confirmé', ready: isAr ? 'جاهز' : 'Prêt', delivered: isAr ? 'تم التسليم' : 'Livré', cancelled: isAr ? 'ملغى' : 'Annulé' };
    return labels[s] || s;
  };

  if (loading) return (<div className="space-y-3"><ListSkeleton count={3} /></div>);

  if (orders.length === 0) {
    return (<div className="flex flex-col items-center justify-center py-16 text-center"><Package size={48} className="text-muted-foreground/30" /><p className="mt-4 text-sm text-muted-foreground">{isAr ? 'لا توجد طلبات حِرفة بعد' : 'Aucune commande artisanat'}</p></div>);
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-1.5 text-lg font-black text-foreground"><ShoppingBag size={18} className="text-primary" />{isAr ? 'طلباتي من حِرفة' : 'Mes commandes artisanat'}</h2>
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between"><div><span className="font-mono text-xs font-bold text-primary">{order.code}</span></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor(order.status)}`}>{statusLabel(order.status)}</span></div>
            <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs font-bold text-foreground">{t.craftedBy} {order.artisan.displayName}</p></div>
            {order.deliveryOption === 'wassilha_delivery' && (<div className="flex items-center gap-2 rounded-lg bg-blue-50 p-2 dark:bg-blue-950/20"><Truck size={14} className="text-blue-600" /><span className="text-xs font-semibold text-blue-700">{t.wassilhaDelivery}</span></div>)}
            <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-xs font-bold text-foreground">{t.total}</span><span className="text-sm font-black text-primary">{order.totalPrice} {t.currencyDzd}</span></div>
            {order.status === 'delivered' && !order.review && (<Button onClick={() => { setRatingOrderId(order.id); setRatingOrderArtisan(order.artisan.displayName); }} variant="outline" className="w-full rounded-xl border-amber-200 text-xs font-bold text-amber-600"><Star size={14} className="me-1" />{t.rateCraftOrder}</Button>)}
            {order.status === 'delivered' && order.review && (<div className="flex items-center justify-center gap-1 rounded-lg bg-muted/50 p-2"><Star size={14} className="text-amber-400" fill="currentColor" /><span className="text-xs font-semibold text-muted-foreground">{isAr ? 'تم التقييم' : 'Évalué'}</span></div>)}
          </Card>
        ))}
      </div>
      {ratingOrderId && (<CraftRatingDialog open={true} onOpenChange={(o) => { if (!o) { setRatingOrderId(null); setRatingOrderArtisan(null); } }} orderId={ratingOrderId} artisanName={ratingOrderArtisan} onSubmitted={() => load()} />)}
    </div>
  );
}