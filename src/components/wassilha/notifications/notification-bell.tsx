'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useT } from '../use-t';
import { NotificationCenter } from './notification-center';

// ---------------------------------------------------------------------------
// Notification bell (Phase 2 UI) — header entry point to the Notification
// Center for EVERY role (customer / driver / artisan / admin).
//
// Owns the unread badge: fetched from /api/notifications/unread-count on
// mount, refreshed every 30s and whenever the app returns to the
// foreground. The count is ALSO corrected instantly by the center itself
// via onUnreadChange (mark-one / mark-all), so the badge never waits for a
// poll after the user reads something.
// ---------------------------------------------------------------------------

const POLL_MS = 30_000;

export function NotificationBell() {
  const { t, isRtl } = useT();
  const user = useAppStore((s) => s.user);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    // No session => no center: skip the call entirely (otherwise every
    // tick would 401 while the auth screen is up).
    if (!user) return;
    api
      .getUnreadNotificationCount()
      .then((r) => setUnread(Number(r.unreadCount) || 0))
      .catch(() => {
        /* offline / expired session: keep showing the last known badge */
      });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    refresh();
    const id = setInterval(refresh, POLL_MS);
    // A notification created while the app was backgrounded should show up
    // as soon as the user comes back, not 30s later.
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refresh]);

  // No signed-in user: no bell (the auth screen has its own header).
  if (!user) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // The badge can drift while the sheet is closed (a new order lands);
        // refreshing on open keeps it honest before the list even mounts.
        if (o) refresh();
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t.notifications}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Bell size={18} />
          {unread > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white',
                // Keep the badge on the outer edge in both directions.
                isRtl ? '-left-0.5' : '-right-0.5',
              )}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        // Open from the edge the trigger actually sits on (left in RTL,
        // right in LTR) so the panel feels connected to the bell.
        side={isRtl ? 'left' : 'right'}
        className="w-full gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b border-border/60 p-4">
          <SheetTitle className="text-base font-black text-foreground">
            {t.notifications}
          </SheetTitle>
        </SheetHeader>
        <div className="wassilha-scroll min-h-0 flex-1 overflow-y-auto p-4">
          <NotificationCenter onUnreadChange={setUnread} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
