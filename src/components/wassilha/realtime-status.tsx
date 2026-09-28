'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { onRealtimeStateChange, type RealtimeStatus } from '@/lib/realtime';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useT } from './use-t';

// ---------------------------------------------------------------------------
// PHASE 6 - realtime connection chip (Part 18).
//
// The brief requires every realtime screen to be honest about connecting /
// connected / reconnecting / offline instead of showing an infinite spinner or
// a silently-stale list. This is that honest signal, in one tiny component.
//
// It is deliberately NON-BLOCKING: it never gates rendering and never disables
// an action. When realtime is down the app keeps working over REST (Part 16) —
// the chip just explains why a screen might be a few seconds behind.
//
// Mobile-first (Part 20): a dot + short label, no banner and no modal, so it
// cannot interrupt an in-progress offer or trip interaction.
// ---------------------------------------------------------------------------

/** Do not flash a "connecting" state on a quiet mount; settle first. */
const SETTLE_MS = 600;

export function RealtimeStatusChip({ className }: { className?: string }) {
  const { t } = useT();
  const user = useAppStore((s) => s.user);
  const [status, setStatus] = useState<RealtimeStatus | null>(null);

  useEffect(() => {
    // No session => no socket. The render guard below already hides the chip in
    // that case, so there is deliberately no setState here: resetting in the
    // effect body would only cause a cascading render (react-hooks/
    // set-state-in-effect) to produce a value nothing can see.
    if (!user) return;
    const off = onRealtimeStateChange((next) => setStatus(next));
    // `state_change` only fires on a TRANSITION, so a socket that is already
    // connected when this mounts would otherwise report nothing at all.
    const timer = setTimeout(() => setStatus((prev) => prev ?? 'connecting'), SETTLE_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [user]);

  // Anonymous / not yet determined: invisible, not alarming.
  if (!user || !status) return null;

  // Healthy: a small green dot and one word. "connected" is the absence of a
  // problem, so it needs no explanation — this keeps the header quiet.
  if (status === 'connected') {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 text-[10px] text-muted-foreground', className)}
        title={t.realtimeConnected}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t.realtimeLive}
      </span>
    );
  }

  const offline = status === 'offline' || status === 'unavailable';
  const label =
    status === 'connecting'
      ? t.realtimeConnecting
      : status === 'reconnecting'
        ? t.realtimeReconnecting
        : t.realtimeOffline;

  const Icon = status === 'connecting' ? Loader2 : offline ? WifiOff : Wifi;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
        offline ? 'bg-amber-500/10 text-amber-600' : 'bg-muted text-muted-foreground',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon size={11} className={status === 'connecting' ? 'animate-spin' : undefined} />
      {label}
    </span>
  );
}
