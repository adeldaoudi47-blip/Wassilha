'use client';

import { useState, useEffect } from 'react';
import { 
  Car, 
  Package, 
  Store, 
  ShoppingBag, 
  ArrowRight, 
  ArrowLeft,
  Clock, 
  MapPin, 
  ChevronRight, 
  ChevronLeft,
  Sparkles, 
  ShieldCheck, 
  AlertCircle,
  Loader2,
  RefreshCw,
  Bell,
  Wallet,
  Receipt,
  Tag
} from 'lucide-react';
import { useT } from '../use-t';
import { useAppStore, useNavStore } from '@/lib/store';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isActiveOrderStatus } from '@/lib/types';
import type { Order, PublicArtisanTile } from '@/lib/types';

interface SuperAppHomeProps {
  onSelectService: (service: 'taxi' | 'cargo') => void;
}

export function SuperAppHome({ onSelectService }: SuperAppHomeProps) {
  const { t, isAr, isRtl } = useT();
  const user = useAppStore((s) => s.user);
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);

  // Active orders state
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [orderError, setOrderError] = useState(false);

  // Featured stores teaser state (limit to max 4 for clean home teaser)
  const [stores, setStores] = useState<PublicArtisanTile[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Load active orders (real-data only, no mock)
  const fetchActiveOrder = async () => {
    try {
      setLoadingOrder(true);
      setOrderError(false);
      const orders = await api.listOrders({ role: 'customer' });
      const found = orders.find((o) => isActiveOrderStatus(o.status));
      setActiveOrder(found || null);
    } catch {
      setOrderError(true);
    } finally {
      setLoadingOrder(false);
    }
  };

  useEffect(() => {
    fetchActiveOrder();
    // Load real craft stores for the teaser section
    api.listMarketplaceStores()
      .then((res) => {
        setStores(res.slice(0, 4));
      })
      .catch(() => setStores([]))
      .finally(() => setLoadingStores(false));
  }, []);

  const ChevronIcon = isRtl ? ChevronLeft : ChevronRight;
  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-5 pb-28">
      {/* 1. Header: Brand, User Greeting, Location & Actions */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span>{t.superAppLocation}</span>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            {user?.name ? `${t.superAppWelcome}، ${user.name}` : t.superAppWelcome}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="relative h-10 w-10 rounded-xl border-border/60 bg-card shadow-sm hover:bg-muted"
            onClick={() => setCustomerTab('offers')}
            title={t.quickOffers}
          >
            <Tag className="h-4 w-4 text-foreground/80" />
          </Button>
        </div>
      </div>

      {/* 2. Active Order Banner (Real Data, Hidden if none, Skeleton while loading) */}
      {loadingOrder ? (
        <Card className="border border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </CardContent>
        </Card>
      ) : orderError ? (
        <Card className="border border-destructive/20 bg-destructive/5">
          <CardContent className="p-3.5 flex items-center justify-between text-xs text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{isAr ? 'تعذر جلب حالة الطلب الحالي' : 'Impossible de récupérer la commande'}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchActiveOrder} className="h-7 text-xs gap-1">
              <RefreshCw className="h-3 w-3" />
              <span>{isAr ? 'إعادة المحاولة' : 'Réessayer'}</span>
            </Button>
          </CardContent>
        </Card>
      ) : activeOrder ? (
        <Card className="overflow-hidden border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                  {t.activeOrderTitle}
                </span>
              </div>
              <Badge variant="outline" className="text-[11px] font-medium border-primary/30 bg-primary/10 text-primary">
                {activeOrder.status === 'searching' && t.orderStatusSearching}
                {activeOrder.status === 'accepted' && t.orderStatusAccepted}
                {activeOrder.status === 'picked' && t.orderStatusPicked}
                {activeOrder.status === 'scheduled' && (t.scheduled || 'مجدول')}
              </Badge>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                {activeOrder.cargoType === 'taxi' ? (
                  <Car className="h-4 w-4 text-foreground/70" />
                ) : (
                  <Package className="h-4 w-4 text-foreground/70" />
                )}
                <span className="font-medium text-foreground">
                  {activeOrder.cargoType === 'taxi' ? t.taxiServiceTitle : t.cargoServiceTitle}
                </span>
              </div>
              {activeOrder.driver && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {isAr ? `السائق: ${activeOrder.driver.name}` : `Chauffeur: ${activeOrder.driver.name}`}
                </span>
              )}
            </div>

            <Button
              className="w-full gap-2 rounded-xl text-xs font-semibold shadow-sm"
              size="sm"
              onClick={() => {
                setActiveOrderId(activeOrder.id);
                setCustomerTab('track');
              }}
            >
              <span>{t.trackActiveOrder}</span>
              <ArrowIcon className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* 3. Main Services Grid (2x2 Cards: Taxi, Cargo, Craft, Shopping) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground tracking-tight">
            {t.superAppServices}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {isAr ? 'القرارة وضواحيها' : 'El Guerrara'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Service 1: Taxi */}
          <button
            type="button"
            onClick={() => onSelectService('taxi')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card to-amber-500/5 p-4 text-start shadow-sm transition-all hover:border-amber-500/40 hover:shadow-md active:scale-[0.98]"
          >
            <div className="space-y-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 transition-transform group-hover:scale-110">
                <Car className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground leading-snug">
                  {t.taxiServiceTitle}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t.taxiServiceDesc}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-amber-600">
              <span>{isAr ? 'اطلب الآن' : 'Commander'}</span>
              <ChevronIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>

          {/* Service 2: Cargo */}
          <button
            type="button"
            onClick={() => onSelectService('cargo')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card to-primary/5 p-4 text-start shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.98]"
          >
            <div className="space-y-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground leading-snug">
                  {t.cargoServiceTitle}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t.cargoServiceDesc}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-primary">
              <span>{isAr ? 'إرسال شحنة' : 'Envoyer'}</span>
              <ChevronIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>

          {/* Service 3: Craft (Hirfa Marketplace) */}
          <button
            type="button"
            onClick={() => setCustomerTab('hirfa')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card to-purple-500/5 p-4 text-start shadow-sm transition-all hover:border-purple-500/40 hover:shadow-md active:scale-[0.98]"
          >
            <div className="space-y-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 transition-transform group-hover:scale-110">
                <Store className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground leading-snug">
                  {t.craftServiceTitle}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t.craftServiceDesc}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-purple-600">
              <span>{isAr ? 'تصفح السوق' : 'Explorer'}</span>
              <ChevronIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>

          {/* Service 4: Shopping (Connected cleanly to Craft stores / Marketplace) */}
          <button
            type="button"
            onClick={() => setCustomerTab('hirfa')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card to-emerald-500/5 p-4 text-start shadow-sm transition-all hover:border-emerald-500/40 hover:shadow-md active:scale-[0.98]"
          >
            <div className="space-y-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-transform group-hover:scale-110">
                <ShoppingBag className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground leading-snug">
                  {t.shoppingServiceTitle}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t.shoppingServiceDesc}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
              <span>{isAr ? 'المتاجر المحلية' : 'Boutiques'}</span>
              <ChevronIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        </div>
      </div>

      {/* 4. Quick Actions Bar */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {t.quickActions}
        </h2>
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setCustomerTab('history')}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-card p-3 text-center transition-colors hover:bg-muted active:scale-95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
              <Receipt className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground">{t.quickMyOrders}</span>
          </button>

          <button
            type="button"
            onClick={() => setCustomerTab('hirfa')}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-card p-3 text-center transition-colors hover:bg-muted active:scale-95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600">
              <Store className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground">{t.quickCraft}</span>
          </button>

          <button
            type="button"
            onClick={() => setCustomerTab('offers')}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-card p-3 text-center transition-colors hover:bg-muted active:scale-95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <Tag className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground">{t.quickOffers}</span>
          </button>

          <button
            type="button"
            onClick={() => setCustomerTab('wallet')}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-card p-3 text-center transition-colors hover:bg-muted active:scale-95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Wallet className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground">{t.myWallet}</span>
          </button>
        </div>
      </div>

      {/* 5. Featured Craft Teaser (Real Data from listMarketplaceStores, Limited to 4) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground tracking-tight">
              {t.featuredStoresTitle}
            </h2>
            <Badge variant="secondary" className="text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20">
              <Sparkles className="h-2.5 w-2.5 mr-0.5 ml-0.5" />
              {isAr ? 'حِرفة' : 'Hirfa'}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() => setCustomerTab('hirfa')}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <span>{t.viewAllStores}</span>
            <ChevronIcon className="h-3 w-3" />
          </button>
        </div>

        {loadingStores ? (
          <div className="grid grid-cols-2 gap-2.5">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-card p-3 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : stores.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5">
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => setCustomerTab('hirfa')}
                className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-3 text-start transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div>
                  <h4 className="text-xs font-bold text-foreground line-clamp-1">{store.displayName}</h4>
                  <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                    {store.area?.nameAr || (isAr ? 'متجر محلي معتمد' : 'Boutique locale certifiée')}
                  </p>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/30 pt-1.5">
                  <span>{store.productCount} {isAr ? 'منتج' : 'produits'}</span>
                  {typeof store.rating === 'number' && store.rating > 0 && (
                    <span className="font-semibold text-amber-600">★ {store.rating.toFixed(1)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {isAr ? 'المتاجر المحلية متاحة في ركن حِرفة' : 'Boutiques disponibles dans l\'espace Hirfa'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustomerTab('hirfa')}
              className="mt-2 text-xs font-medium"
            >
              {t.viewAllCraft}
            </Button>
          </div>
        )}
      </div>

      {/* 6. Trust & Local Footer Badge */}
      <div className="rounded-xl border border-border/40 bg-muted/30 p-3 text-center">
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>{isAr ? 'خدمة محلية آمنة وموثوقة 100% في القرارة' : 'Service 100% local et sécurisé à El Guerrara'}</span>
        </div>
      </div>
    </div>
  );
}