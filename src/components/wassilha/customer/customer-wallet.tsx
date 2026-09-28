'use client';

import { ShieldCheck, Wallet, ArrowUpRight, ArrowDownLeft, Clock, Banknote, Sparkles } from 'lucide-react';
import { useT } from '../use-t';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function CustomerWallet() {
  const { t, isAr } = useT();

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{t.walletTitle}</h1>
            <p className="text-xs text-muted-foreground">{t.superAppLocation}</p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
          <Sparkles className="h-3 w-3" />
          {t.walletComingSoonBadge}
        </Badge>
      </div>

      {/* Balance Card */}
      <Card className="overflow-hidden border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t.walletBalanceLabel}</span>
            <span className="font-semibold text-foreground/80">{t.walletCurrency}</span>
          </div>
          
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tracking-tight text-foreground">0</span>
            <span className="text-sm font-medium text-muted-foreground">{t.walletCurrency}</span>
          </div>

          <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
            <div className="flex items-start gap-2.5">
              <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-primary">{t.walletCashNoticeTitle}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t.walletCashNoticeDesc}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trust & Safe Badge */}
      <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
        <span className="leading-snug">
          {isAr
            ? 'نظام مدفوعات محلي موثوق يضمن حقوق العميل والسائق وأصحاب المحلات بالقرارة.'
            : 'Système de paiement local sécurisé garantissant les droits de tous.'}
        </span>
      </div>

      {/* Upcoming Features Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t.walletFeaturesListTitle}</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card p-3.5 text-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            <span className="font-medium text-foreground/90">{t.walletFeature1}</span>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card p-3.5 text-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
              <Clock className="h-4 w-4" />
            </div>
            <span className="font-medium text-foreground/90">{t.walletFeature2}</span>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card p-3.5 text-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
            <span className="font-medium text-foreground/90">{t.walletFeature3}</span>
          </div>
        </div>
      </div>
    </div>
  );
}