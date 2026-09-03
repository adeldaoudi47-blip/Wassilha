"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * ConfirmDialog — a thin, opinionated wrapper around shadcn's
 * `AlertDialog`. It collapses the typical "open / title / description
 * / confirm / cancel" boilerplate into a single, declarative API
 * suitable for destructive flows (delete, reset, ban, etc.).
 *
 * The dialog intentionally does NOT auto-close on confirm: the
 * caller's `onConfirm` is expected to do its own async work, then
 * flip the `open` state to false. This avoids a UI state where the
 * dialog disappears while the request is still in flight, which
 * would leak the optimistic state update.
 *
 * SECURITY: for destructive flows, set `destructive` so the confirm
 * button uses the destructive Tailwind variant (`bg-destructive
 * text-destructive-foreground`). This is a UI guard rail only —
 * server-side authorization must still be enforced by the route
 * handler.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Use destructive styling for the confirm button. */
  destructive?: boolean;
  /** Disables both buttons and prevents auto-close. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (loading) return;
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              if (!loading) onCancel();
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              // Prevent Radix's auto-close on Action so the dialog
              // stays open until the caller's async work completes.
              e.preventDefault();
              if (!loading) onConfirm();
            }}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" })
            )}
          >
            {loading ? "..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
