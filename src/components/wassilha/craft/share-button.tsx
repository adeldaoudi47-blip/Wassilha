'use client';

// HIRFA Phase 1 — reusable Share component for public storefront/product.
// Supports Web Share API, Copy Link, WhatsApp, Facebook with a safe fallback.
// SSR-safe: navigator access is deferred to an effect (no hydration mismatch).
import { useState } from 'react';
import { Share2, Copy, Check, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import type { Lang } from '@/lib/types';
import type { CraftEventType } from '@/lib/analytics';

export interface ShareTarget {
  title: string;
  text: string;
  url: string; // must be an absolute URL
}

/**
 * Optional analytics context. When provided, a `share` event is tracked when
 * the visitor actually shares (native sheet / WhatsApp / Facebook) and a
 * `copy_link` event when they copy the link. Events are anonymous (ids only).
 */
export interface ShareAnalytics {
  storeId?: string;
  productId?: string;
}

interface ShareButtonProps {
  target: ShareTarget;
  lang?: Lang;
  label?: string;
  analytics?: ShareAnalytics;
}

export function ShareButton({ target, lang = 'ar', label, analytics }: ShareButtonProps) {
  const t = getMarketplaceT(lang);
  const [copied, setCopied] = useState(false);

  // Fire-and-forget anonymous event. Never blocks the share UX.
  const track = (eventType: CraftEventType) => {
    if (!analytics?.storeId) return;
    try {
      fetch('/api/craft/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: eventType,
          storeId: analytics.storeId,
          productId: analytics.productId,
        }),
        keepalive: true,
        credentials: 'omit',
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  };

  const onCopy = async () => {
    track('copy_link');
    try {
      await navigator.clipboard.writeText(target.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. non-HTTPS) — show the link so the seller can
      // copy it manually. prompt() is the last-resort fallback.
      window.prompt(t.copyLink, target.url);
    }
  };

  const onNativeShare = async () => {
    track('share');
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: target.title, text: target.text, url: target.url });
        return;
      } catch {
        // user cancelled — do nothing, the menu stays open
        return;
      }
    }
    await onCopy();
  };

  const encodedUrl = encodeURIComponent(target.url);
  const encodedText = encodeURIComponent(`${target.text} ${target.url}`);
  const waUrl = `https://wa.me/?text=${encodedText}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-2 rounded-xl px-3 text-xs font-bold"
          aria-label={t.share}
        >
          <Share2 size={15} />
          <span>{label || t.share}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onCopy}>
          {copied ? <Check size={14} className="me-2 text-green-500" /> : <Copy size={14} className="me-2" />}
          <span>{copied ? t.copied : t.copyLink}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full cursor-pointer gap-2"
            onClick={() => track('share')}
          >
            <MessageCircle size={14} className="me-2 text-green-500" />
            <span>{t.whatsapp}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={fbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full cursor-pointer gap-2"
            onClick={() => track('share')}
          >
            {/* Facebook "f" icon (inline SVG, no extra dependency) */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="me-2 text-blue-600"
              aria-hidden
            >
              <path d="M22.675 0h-21.35C.6 0 0 .6 0 1.326v21.348C0 23.4.6 24 1.326 24h11.494v-9.294H9.691V11.01h3.129V8.413c0-3.1 1.894-4.788 4.66-4.788 1.34 0 2.48.992 2.48 2.179v3.418h-2.238v3.684h3.997V24C23.4 24 24 23.4 24 22.674V1.326C24 .6 23.4 0 22.675 0" />
            </svg>
            <span>{t.facebook}</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

