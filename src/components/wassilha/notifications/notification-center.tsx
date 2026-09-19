'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Bike,
  CheckCheck,
  Loader2,
  Package,
  ShoppingBag,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Translation } from '@/lib/i18n';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '../skeleton';
import type { AppNotification } from '@/lib/types';

// ---------------------------------------------------------------------------
// Notification Center (in-app notifications — Phase 2 UI).
//
// Lists the caller's own notifications (the API scopes every query by the
// session, so a client can never see another user's rows), marks a row read
// on tap, and offers "mark all read".
//
// LOCALIZATION: the server stores FINISHED Arabic title/body, but also an
// optional `data.i18n` ref ({ titleKey, bodyKey, params }). When present,
// `resolveText` re-resolves the strings from the active translation table,
// so a French user reads French with no schema change.
// ---------------------------------------------------------------------------

const TYPE_META: Record<string, { icon: LucideIcon; className: string }> = {
  order: {
    icon: Package,
    className: 'bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300',
  },
  craft_order: {
    icon: ShoppingBag,
    className:
      'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  driver_application: {
    icon: Bike,
    className:
      'bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300',
  },
  artisan_application: {
    icon: Store,
    className:
      'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300',
  },
  system: {
    icon: Bell,
    className: 'bg-primary/10 text-primary',
  },
};

const DEFAULT_TYPE_META: { icon: LucideIcon; className: string } = {
  icon: Bell,
  className: 'bg-muted text-muted-foreground',
};

// Relative timestamp ("منذ 5 دقائق" / "il y a 5 min"). Uses the platform
// Intl formatter (zero bundle cost, correct plurals), with a manual
// fallback for the rare environment that lacks Arabic/FR ICU data.
function formatRelative(dateStr: string, isAr: boolean): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  // Past ~30 days an absolute date reads better than "منذ 30 يوماً".
  if (abs > 30 * 86400) {
    try {
      return new Date(then).toLocaleDateString(isAr ? 'ar-DZ' : 'fr-DZ');
    } catch {
      return '';
    }
  }
  try {
    // `-u-nu-latn` keeps Western digits ("منذ 5 دقائق", not "منذ ٥ دقائق").
    const rtf = new Intl.RelativeTimeFormat(isAr ? 'ar-u-nu-latn' : 'fr', {
      numeric: 'auto',
    });
    if (abs < 60) return rtf.format(diffSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    return rtf.format(Math.round(diffSec / 86400), 'day');
  } catch {
    const n = Math.max(
      1,
      abs < 3600
        ? Math.round(abs / 60)
        : abs < 86400
          ? Math.round(abs / 3600)
          : Math.round(abs / 86400),
    );
    if (abs < 3600) return isAr ? `منذ ${n} دقيقة` : `il y a ${n} min`;
    if (abs < 86400) return isAr ? `منذ ${n} ساعة` : `il y a ${n} h`;
    return isAr ? `منذ ${n} يوم` : `il y a ${n} j`;
  }
}

// Falls back to the stored Arabic text whenever a key is missing or the
// emitter left no i18n ref at all — the center NEVER renders a blank card.
function resolveText(
  n: AppNotification,
  t: Translation,
): { title: string; body: string } {
  const ref = n.data?.i18n;
  if (!ref) return { title: n.title, body: n.body };
  const dict = t as unknown as Record<string, string>;
  const apply = (
    raw: string,
    key: string | undefined,
    params?: Record<string, string | number>,
  ): string => {
    if (!key || !dict[key]) return raw;
    if (!params) return dict[key];
    return Object.entries(params).reduce(
      (out, [k, v]) => out.split(`{${k}}`).join(String(v)),
      dict[key],
    );
  };
  return {
    title: apply(n.title, ref.titleKey, ref.params),
    body: apply(n.body, ref.bodyKey, ref.params),
  };
}

export interface NotificationCenterProps {
  // Lets the host bell badge stay in sync with reads done inside the
  // center (mark-one / mark-all) instead of waiting for the next poll.
  onUnreadChange?: (unreadCount: number) => void;
}

export function NotificationCenter({ onUnreadChange }: NotificationCenterProps) {
  const { t, isAr } = useT();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const report = useCallback(
    (n: number) => onUnreadChange?.(n),
    [onUnreadChange],
  );

  const load = useCallback(() => {
    setLoading(true);
    api
      .getNotifications({ pageSize: 40 })
      .then((res) => {
        setItems(res.notifications);
        report(res.unreadCount ?? 0);
      })
      .catch(() => toast.error(t.fetchError))
      .finally(() => setLoading(false));
  }, [report, t.fetchError]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    const row = items.find((i) => i.id === id);
    // Already read (or a duplicate tap while the PATCH is in flight): no-op,
    // so the card never fires redundant writes.
    if (!row || row.isRead || actingId === id) return;
    // Optimistic: flip the row + badge now, revert on failure.
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: true } : i)));
    setActingId(id);
    try {
      await api.markNotificationRead(id);
      setItems((prev) => {
        const next = prev.map((i) => (i.id === id ? { ...i, isRead: true } : i));
        report(next.filter((i) => !i.isRead).length);
        return next;
      });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: false } : i)));
      toast.error(t.fetchError);
    } finally {
      setActingId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
      report(0);
      toast.success(t.markAllRead);
    } catch {
      toast.error(t.fetchError);
    } finally {
      setMarkingAll(false);
    }
  };

  const unread = items.filter((i) => !i.isRead).length;

  if (loading) {
    return (
      <div className="space-y-2.5">
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Bell size={48} className="text-muted-foreground/30" />
        <p className="mt-4 text-sm text-muted-foreground">{t.noNotifications}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black text-foreground">{t.notifications}</h2>
          {unread > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={unread === 0 || markingAll}
          onClick={markAllRead}
          className="text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
        >
          {markingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCheck size={14} className="me-1" />
          )}
          {t.markAllRead}
        </Button>
      </div>

      <div className="space-y-2.5">
        {items.map((n) => {
          const meta = TYPE_META[n.type] ?? DEFAULT_TYPE_META;
          const Icon = meta.icon;
          const { title, body } = resolveText(n, t);
          return (
            <Card
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => markRead(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  markRead(n.id);
                }
              }}
              aria-label={title}
              className={cn(
                'flex items-start gap-3 p-3.5 transition-colors',
                !n.isRead
                  ? 'border-primary/30 bg-primary/[0.03]'
                  : 'bg-card',
                actingId === n.id && 'opacity-60',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  meta.className,
                )}
              >
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm leading-snug text-foreground',
                    n.isRead ? 'font-semibold' : 'font-bold',
                  )}
                >
                  {title}
                </p>
                {body && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {formatRelative(n.createdAt, isAr)}
                </p>
              </div>
              {!n.isRead && (
                <span
                  aria-label={isAr ? 'غير مقروء' : 'Non lu'}
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500"
                />
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}


