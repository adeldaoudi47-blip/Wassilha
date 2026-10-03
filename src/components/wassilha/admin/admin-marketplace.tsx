'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Package,
  ClipboardList,
  Flag,
  Store as StoreIcon,
  CheckCircle2,
  XCircle,
  PauseCircle,
  RotateCcw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDzd } from '@/lib/wassilha-data';
// The transition table is shared with the server on purpose: the buttons shown
// here are filtered by `canModerate`, so the UI can never offer an action the
// API would reject as an illegal transition.
import { canModerate, MODERATION_ACTIONS } from '@/lib/marketplace-moderation';
import type {
  SellerProduct,
  AdminMarketplaceOrder,
  AdminMarketplaceReport,
  AdminMarketplaceStore,
  ProductModerationStatus,
  ReportStatus,
  ModerationAction,
} from '@/lib/types';

type Tab = 'products' | 'orders' | 'reports' | 'stores';

/**
 * PHASE 9 — marketplace administration.
 *
 * One screen with four internal tabs (products / orders / reports / stores)
 * rather than four more top-level nav entries, which keeps the admin sidebar
 * short while still giving each queue its own focused view.
 *
 * SECURITY: this component is presentation only. Every action it offers is
 * re-checked server-side by requirePrivilegedAdmin() and the shared transition
 * table, so a hidden button is a UX affordance and never the control.
 *
 * The two monies are always shown as two separate labelled figures: the product
 * subtotal (seller) and the delivery fee (driver) are never summed.
 */
export function AdminMarketplace() {
  const { t, isAr } = useT();
  const [tab, setTab] = useState<Tab>('products');

  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { key: 'products', label: t.mpProductsTab, icon: Package },
    { key: 'orders', label: t.mpOrdersTab, icon: ClipboardList },
    { key: 'reports', label: t.mpReportsTab, icon: Flag },
    { key: 'stores', label: t.mpStoresTab, icon: StoreIcon },
  ];

  return (
    <div className="space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Internal tab bar — Arabic-first: the first tab (products) is the
          queue that needs attention soonest, so it is the default view. */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              aria-selected={active}
              role="tab"
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon size={14} />
              {tb.label}
            </button>
          );
        })}
      </div>

      {tab === 'products' ? <ProductsTab /> : null}
      {tab === 'orders' ? <OrdersTab /> : null}
      {tab === 'reports' ? <ReportsTab /> : null}
      {tab === 'stores' ? <StoresTab /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/**
 * Minimal fetch-on-mount helper with a manual `reload()` for after an action.
 * Each tab loads ONLY while it is mounted, so opening the screen does not fire
 * four admin queries at once.
 */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fn()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, busy, setBusy, reload };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusPill({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black', className)}>
      {children}
    </span>
  );
}

/** Reason textarea, shown only while an action that REQUIRES a reason is armed. */
function ReasonBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      maxLength={500}
      className="mt-2 w-full resize-none rounded-xl border border-border bg-background p-2 text-xs outline-none focus:border-emerald-500"
    />
  );
}

// ---------------------------------------------------------------------------
// Products — the moderation queue
// ---------------------------------------------------------------------------

function ProductsTab() {
  const { t } = useT();
  const [filter, setFilter] = useState<ProductModerationStatus | 'all'>('pending');
  const { data, loading, busy, setBusy, reload } = useAsync(
    () => api.getAdminCraftProducts(filter === 'all' ? undefined : filter),
    [filter]
  );
  const products = data?.products ?? [];

  // reject/suspend cannot be sent without an explanation, so the box opens
  // first and the request waits for the admin to write the reason.
  const [armed, setArmed] = useState<{ id: string; action: ModerationAction } | null>(null);
  const [reason, setReason] = useState('');

  const run = async (p: SellerProduct, action: ModerationAction) => {
    const needsReason = action === 'reject' || action === 'suspend';
    if (needsReason && reason.trim().length < 2) {
      setArmed({ id: p.id, action });
      return;
    }
    setBusy(p.id);
    try {
      await api.moderateCraftProduct(p.id, action, needsReason ? reason.trim() : undefined);
      toast.success(t.marketplaceAdmin);
      setArmed(null);
      setReason('');
      reload();
    } catch {
      toast.error(t.mpActionFailed);
    } finally {
      setBusy(null);
    }
  };

  const filterLabel = (f: ProductModerationStatus | 'all') =>
    f === 'all'
      ? t.mpStatusAll
      : f === 'pending'
        ? t.mpStatusPending
        : f === 'approved'
          ? t.mpStatusApproved
          : f === 'rejected'
            ? t.mpStatusRejected
            : t.mpStatusSuspended;

  const filters: (ProductModerationStatus | 'all')[] = [
    'pending',
    'approved',
    'rejected',
    'suspended',
    'all',
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-bold',
              filter === f
                ? 'bg-emerald-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>

      {loading && products.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{t.mpLoading}</p>
      ) : products.length === 0 ? (
        <EmptyState label={t.mpNoProducts} />
      ) : (
        products.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            busy={busy === p.id}
            armed={armed?.id === p.id}
            reason={reason}
            onReasonChange={setReason}
            onAction={(a) => run(p, a)}
            label={filterLabel}
          />
        ))
      )}
    </div>
  );
}

function ProductRow({
  product,
  busy,
  armed,
  reason,
  onReasonChange,
  onAction,
  label,
}: {
  product: SellerProduct;
  busy: boolean;
  armed: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  onAction: (a: ModerationAction) => void;
  label: (f: ProductModerationStatus | 'all') => string;
}) {
  const { t } = useT();
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-foreground">{product.nameAr}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t.mpStoreColumn}: {product.artisan.displayName}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(product.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusPill
          className={
            product.moderationStatus === 'approved'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : product.moderationStatus === 'pending'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
          }
        >
          {label(product.moderationStatus)}
        </StatusPill>
      </div>

      {product.moderationReason ? (
        <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
          {t.mpModerationReason}: {product.moderationReason}
        </p>
      ) : null}

      {armed ? (
        <ReasonBox value={reason} onChange={onReasonChange} placeholder={t.mpReasonPlaceholder} />
      ) : null}

      {/* Only the actions legal from the CURRENT status are rendered, using the
          same predicate the server enforces. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {MODERATION_ACTIONS.filter((a) => canModerate(product.moderationStatus, a)).map((a) => (
          <Button
            key={a}
            onClick={() => onAction(a)}
            disabled={busy}
            size="sm"
            variant={a === 'approve' ? 'default' : 'outline'}
            className={cn(
              'h-8 rounded-xl text-[11px] font-bold',
              a === 'approve' && 'bg-emerald-600 hover:bg-emerald-700',
              a === 'reject' && 'border-red-300 text-red-600 dark:border-red-800',
              a === 'suspend' && 'border-amber-400 text-amber-600 dark:border-amber-700',
              a === 'restore' && 'border-emerald-400 text-emerald-700'
            )}
          >
            {a === 'approve' ? <CheckCircle2 size={13} className="me-1" /> : null}
            {a === 'reject' ? <XCircle size={13} className="me-1" /> : null}
            {a === 'suspend' ? <PauseCircle size={13} className="me-1" /> : null}
            {a === 'restore' ? <RotateCcw size={13} className="me-1" /> : null}
            {a === 'approve'
              ? t.mpActionApprove
              : a === 'reject'
                ? t.mpActionReject
                : a === 'suspend'
                  ? t.mpActionSuspend
                  : t.mpActionRestore}
          </Button>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Orders — oversight (READ ONLY)
// ---------------------------------------------------------------------------

function OrdersTab() {
  const { t } = useT();
  const { data, loading } = useAsync(() => api.getAdminCraftOrders(), []);
  const orders = data?.orders ?? [];

  if (loading && orders.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{t.mpLoading}</p>;
  }
  if (orders.length === 0) return <EmptyState label={t.mpNoOrders} />;

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        // The delivery fee is a DIFFERENT sum of money from the product
        // subtotal: `finalPrice` if the negotiation settled it, else `price`.
        const deliveryFee = o.deliveryOrder?.finalPrice ?? o.deliveryOrder?.price ?? null;
        return (
          <Card key={o.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-foreground">
                  {t.mpOrderColumn} <span dir="ltr">{o.code}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.mpBuyerColumn}: {o.customer.name} · {t.mpStoreColumn}: {o.artisan.displayName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(o.createdAt).toLocaleString()}
                </p>
              </div>
              <StatusPill className="bg-muted text-muted-foreground">{o.status}</StatusPill>
            </div>

            {/* Two SEPARATE labelled figures — never summed. */}
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <span className="font-bold text-foreground">
                {t.mpProductSubtotal}: {formatDzd(o.totalPrice)}
              </span>
              <span className="font-bold text-muted-foreground">
                {t.mpDeliveryFee}:{' '}
                {deliveryFee === null ? '—' : formatDzd(deliveryFee)}
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports — the queue. Closing a report NEVER suspends anything.
// ---------------------------------------------------------------------------

function ReportsTab() {
  const { t } = useT();
  const [filter, setFilter] = useState<ReportStatus | 'all'>('open');
  const { data, loading, busy, setBusy, reload } = useAsync(
    () => api.getAdminCraftReports(filter === 'all' ? undefined : filter),
    [filter]
  );
  const reports = data?.reports ?? [];

  const resolve = async (id: string, status: 'reviewed' | 'resolved' | 'dismissed') => {
    setBusy(id);
    try {
      await api.resolveCraftReport(id, status);
      toast.success(t.marketplaceAdmin);
      reload();
    } catch {
      toast.error(t.mpActionFailed);
    } finally {
      setBusy(null);
    }
  };

  const statusLabel = (s: ReportStatus) =>
    s === 'open'
      ? t.mpReportOpen
      : s === 'reviewed'
        ? t.mpReportReviewed
        : s === 'resolved'
          ? t.mpReportResolved
          : t.mpReportDismissed;

  const reasonLabel = (r: string) =>
    r === 'inappropriate'
      ? t.reportReasonInappropriate
      : r === 'misleading'
        ? t.reportReasonMisleading
        : r === 'prohibited'
          ? t.reportReasonProhibited
          : r === 'counterfeit'
            ? t.reportReasonCounterfeit
            : r === 'spam'
              ? t.reportReasonSpam
              : t.reportReasonOther;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(['open', 'reviewed', 'resolved', 'dismissed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-bold',
              filter === f
                ? 'bg-emerald-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {f === 'all' ? t.mpStatusAll : statusLabel(f)}
          </button>
        ))}
      </div>

      <p className="px-1 text-[11px] text-muted-foreground">{t.mpReportsNeverAutoPunish}</p>

      {loading && reports.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{t.mpLoading}</p>
      ) : reports.length === 0 ? (
        <EmptyState label={t.mpNoReports} />
      ) : (
        reports.map((r) => (
          <ReportRow
            key={r.id}
            report={r}
            busy={busy === r.id}
            onResolve={(s) => resolve(r.id, s)}
            statusLabel={statusLabel}
            reasonLabel={reasonLabel}
          />
        ))
      )}
    </div>
  );
}

function ReportRow({
  report,
  busy,
  onResolve,
  statusLabel,
  reasonLabel,
}: {
  report: AdminMarketplaceReport;
  busy: boolean;
  onResolve: (s: 'reviewed' | 'resolved' | 'dismissed') => void;
  statusLabel: (s: ReportStatus) => string;
  reasonLabel: (r: string) => string;
}) {
  const { t } = useT();
  // A closed report is final, so no buttons are offered for it at all.
  const closed = report.status === 'resolved' || report.status === 'dismissed';
  const targetName =
    report.targetType === 'product'
      ? (report.product?.nameAr ?? '—')
      : (report.artisan?.displayName ?? '—');

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-foreground">
            {report.targetType === 'product' ? t.mpTargetProduct : t.mpTargetStore}: {targetName}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.mpDescriptionColumn}: {reasonLabel(report.reason)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(report.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusPill
          className={
            report.status === 'open'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              : report.status === 'reviewed'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-muted text-muted-foreground'
          }
        >
          {statusLabel(report.status)}
        </StatusPill>
      </div>

      {report.description ? (
        <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
          {report.description}
        </p>
      ) : null}

      {report.resolvedBy ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t.mpModeratedBy}: {report.resolvedBy.name}
        </p>
      ) : null}

      {closed ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => onResolve('reviewed')}
            disabled={busy}
            size="sm"
            variant="outline"
            className="h-8 rounded-xl text-[11px] font-bold"
          >
            {t.mpMarkReviewed}
          </Button>
          <Button
            onClick={() => onResolve('resolved')}
            disabled={busy}
            size="sm"
            className="h-8 rounded-xl bg-emerald-600 text-[11px] font-bold hover:bg-emerald-700"
          >
            {t.mpMarkResolved}
          </Button>
          <Button
            onClick={() => onResolve('dismissed')}
            disabled={busy}
            size="sm"
            variant="outline"
            className="h-8 rounded-xl border-red-300 text-[11px] font-bold text-red-600 dark:border-red-800"
          >
            {t.mpMarkDismissed}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stores — suspension / reinstatement
// ---------------------------------------------------------------------------

function StoresTab() {
  const { t } = useT();
  const { data, loading, busy, setBusy, reload } = useAsync(() => api.getAdminCraftStores(), []);
  const stores = data?.stores ?? [];
  const [armed, setArmed] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const suspend = async (id: string) => {
    if (reason.trim().length < 2) {
      setArmed(id);
      return;
    }
    setBusy(id);
    try {
      await api.suspendCraftStore(id, reason.trim());
      toast.success(t.marketplaceAdmin);
      setArmed(null);
      setReason('');
      reload();
    } catch {
      toast.error(t.mpActionFailed);
    } finally {
      setBusy(null);
    }
  };

  const reinstate = async (id: string) => {
    setBusy(id);
    try {
      await api.reinstateCraftStore(id);
      toast.success(t.marketplaceAdmin);
      reload();
    } catch {
      toast.error(t.mpActionFailed);
    } finally {
      setBusy(null);
    }
  };

  const statusLabel = (s: AdminMarketplaceStore['status']) =>
    s === 'active'
      ? t.mpStoreStatusActive
      : s === 'pending'
        ? t.mpStoreStatusPending
        : s === 'rejected'
          ? t.mpStoreStatusRejected
          : t.mpStoreStatusSuspended;

  if (loading && stores.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{t.mpLoading}</p>;
  }
  if (stores.length === 0) return <EmptyState label={t.mpNoStores} />;

  return (
    <div className="space-y-3">
      {stores.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-foreground">{s.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t.mpOwnerColumn}: {s.user.name} · <span dir="ltr">{s.user.phone}</span>
              </p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </p>
            </div>
            <StatusPill
              className={
                s.status === 'active'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : s.status === 'suspended'
                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-muted text-muted-foreground'
              }
            >
              {statusLabel(s.status)}
            </StatusPill>
          </div>

          {s.suspensionReason ? (
            <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
              {t.mpModerationReason}: {s.suspensionReason}
            </p>
          ) : null}
          {s.suspendedAt ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t.mpSuspendedAt}: {new Date(s.suspendedAt).toLocaleString()}
            </p>
          ) : null}

          {armed === s.id ? (
            <ReasonBox value={reason} onChange={setReason} placeholder={t.mpSuspendStorePrompt} />
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {/* Same rule as the server: only an active store can be suspended,
                only a suspended one can be reinstated. */}
            {s.status === 'active' ? (
              <Button
                onClick={() => suspend(s.id)}
                disabled={busy === s.id}
                size="sm"
                variant="outline"
                className="h-8 rounded-xl border-red-300 text-[11px] font-bold text-red-600 dark:border-red-800"
              >
                <PauseCircle size={13} className="me-1" />
                {t.mpSuspendStore}
              </Button>
            ) : null}
            {s.status === 'suspended' ? (
              <Button
                onClick={() => reinstate(s.id)}
                disabled={busy === s.id}
                size="sm"
                className="h-8 rounded-xl bg-emerald-600 text-[11px] font-bold hover:bg-emerald-700"
              >
                <RotateCcw size={13} className="me-1" />
                {t.mpReinstateStore}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}