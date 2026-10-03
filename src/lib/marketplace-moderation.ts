// ---------------------------------------------------------------------------
// PHASE 9 — MARKETPLACE MODERATION & REPORTING: THE SINGLE SOURCE OF TRUTH.
//
// This module is deliberately PURE: no db import, no Prisma types, no I/O. The
// rules it encodes (which states exist, which transitions are legal, what may
// appear publicly) are the same rules the API routes and the storefront rely
// on, so there is exactly ONE place to audit and one place to test.
//
// Every state here is a FREE STRING with a TS union — the convention this repo
// already uses for Order.status / CraftOrder.status / ArtisanProfile.status
// (it deliberately does not model workflow states as Prisma enums, which would
// need a migration for every new value).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Product moderation
// ---------------------------------------------------------------------------

export const PRODUCT_MODERATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'suspended',
] as const;

export type ProductModerationStatus = (typeof PRODUCT_MODERATION_STATUSES)[number];

/**
 * The ONLY value that may appear on the public marketplace.
 *
 * PUBLIC VISIBILITY IS A WHITELIST, NOT A BLACKLIST: a query must ask for
 * `moderationStatus === 'approved'` rather than "anything that is not
 * suspended". A blacklist would silently publish any future state someone
 * adds; this way an unrecognised value is invisible by default.
 */
export const PUBLIC_PRODUCT_MODERATION_STATUS: ProductModerationStatus = 'approved';

export function isProductModerationStatus(v: unknown): v is ProductModerationStatus {
  return (
    typeof v === 'string' &&
    (PRODUCT_MODERATION_STATUSES as readonly string[]).includes(v)
  );
}

/** True only for the publicly visible state. */
export function isPubliclyVisibleModeration(status: unknown): boolean {
  return status === PUBLIC_PRODUCT_MODERATION_STATUS;
}

/**
 * The Prisma `where` fragment that EVERY public product query must spread in.
 *
 * Being a single exported object (rather than the literal repeated at ~13 call
 * sites) is what makes the guarantee checkable: a new public query that forgets
 * it can be spotted by reading one name.
 */
export const publicProductGate = {
  moderationStatus: PUBLIC_PRODUCT_MODERATION_STATUS,
} as const;

/** A product the SELLER can still work on and resubmit (i.e. rejected). */
export function isSellerRetriable(status: unknown): boolean {
  return status === 'rejected';
}

/**
 * Admin moderation actions and the states each may be applied to.
 *
 * ENCODING THE `from` SET (instead of only the destination) is what prevents
 * invalid transitions: approving an already-approved product, or "restoring"
 * something that was never suspended, is rejected rather than silently
 * rewriting history.
 */
export const MODERATION_ACTIONS = ['approve', 'reject', 'suspend', 'restore'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

const ACTION_FROM: Record<ModerationAction, readonly ProductModerationStatus[]> = {
  // Admins approve a waiting item, a previously rejected one (after the seller
  // corrected it), or reinstate a suspended one.
  approve: ['pending', 'rejected', 'suspended'],
  reject: ['pending', 'approved', 'suspended'],
  // ONLY an approved (live) product may be suspended. Notably NOT 'pending':
  // suspending a pending product would let it reach 'suspended', from which
  // restore -> 'approved', i.e. a product could reach APPROVED having never
  // actually been reviewed. For a pending item the correct action is `reject`.
  suspend: ['approved'],
  // "restore" is the explicit un-suspend and applies to nothing else.
  restore: ['suspended'],
};

const ACTION_TO: Record<ModerationAction, ProductModerationStatus> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  restore: 'approved',
};

export function isModerationAction(v: unknown): v is ModerationAction {
  return typeof v === 'string' && (MODERATION_ACTIONS as readonly string[]).includes(v);
}

export function moderationTargetStatus(action: ModerationAction): ProductModerationStatus {
  return ACTION_TO[action];
}

/** True when `action` is legal from `from`. Unknown states are never legal. */
export function canModerate(from: unknown, action: ModerationAction): boolean {
  if (!isProductModerationStatus(from)) return false;
  if (!isModerationAction(action)) return false;
  return ACTION_FROM[action].includes(from);
}
// ---------------------------------------------------------------------------
// 2. Store / seller status
// ---------------------------------------------------------------------------

export const ARTISAN_STATUSES = ['pending', 'active', 'rejected', 'suspended'] as const;
export type ArtisanStatus = (typeof ARTISAN_STATUSES)[number];

export type StoreModerationAction = 'suspend' | 'reinstate';

/**
 * Store suspension is a STATE, not a separate flag: `status` becomes
 * "suspended", which the two existing gates already understand —
 *   * requireActiveArtisan()             -> blocks every seller write
 *   * public queries (status: 'active')  -> hides the store + its products
 * so enforcement needs no second check that a future route could forget.
 *
 * A suspension is only meaningful from "active" (a pending/rejected store is
 * not public to begin with), and reinstate returns it to "active".
 */
export function canModerateStore(from: unknown, action: StoreModerationAction): boolean {
  if (action === 'suspend') return from === 'active';
  if (action === 'reinstate') return from === 'suspended';
  return false;
}

export function isArtisanStatus(v: unknown): v is ArtisanStatus {
  return typeof v === 'string' && (ARTISAN_STATUSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// 3. Reports / flags
// ---------------------------------------------------------------------------

export const REPORT_TARGET_TYPES = ['product', 'store'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/**
 * Predefined reasons only (plus free text in `description`). A closed list keeps
 * the queue triageable and stops the reporter from writing an essay into the
 * reason column — the optional description is where detail belongs.
 */
export const REPORT_REASONS = [
  'inappropriate',
  'misleading',
  'prohibited',
  'counterfeit',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'reviewed', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export function isReportTargetType(v: unknown): v is ReportTargetType {
  return typeof v === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(v);
}

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
}

export function isReportStatus(v: unknown): v is ReportStatus {
  return typeof v === 'string' && (REPORT_STATUSES as readonly string[]).includes(v);
}

/** Statuses an admin may MOVE a report to. "open" is the creation state only. */
export const REPORT_RESOLUTION_STATUSES = ['reviewed', 'resolved', 'dismissed'] as const;
export type ReportResolutionStatus = (typeof REPORT_RESOLUTION_STATUSES)[number];

const REPORT_FROM: Record<ReportResolutionStatus, readonly ReportStatus[]> = {
  // An admin can look at something again ("open" -> "reviewed").
  reviewed: ['open', 'reviewed'],
  // Terminal outcomes. A resolved/dismissed report is closed: re-opening it
  // would make "who decided what, when" ambiguous, which is the one thing this
  // record exists to keep straight.
  resolved: ['open', 'reviewed'],
  dismissed: ['open', 'reviewed'],
};

export function isReportResolutionStatus(v: unknown): v is ReportResolutionStatus {
  return (
    typeof v === 'string' &&
    (REPORT_RESOLUTION_STATUSES as readonly string[]).includes(v)
  );
}

export function canResolveReport(from: unknown, to: ReportResolutionStatus): boolean {
  if (!isReportStatus(from)) return false;
  return REPORT_FROM[to].includes(from);
}

/** resolved/dismissed are terminal — used by the queue filters + UI. */
export function isTerminalReportStatus(status: unknown): boolean {
  return status === 'resolved' || status === 'dismissed';
}

/**
 * A report may only be filed against an ACTIVE, publicly visible target —
 * otherwise a reporter could probe for the existence of hidden products by
 * watching which reports the API accepts.
 */
export function reportTargetIsPublic(args: {
  targetType: ReportTargetType;
  productStatus?: unknown;
  artisanStatus?: unknown;
  productArtisanStatus?: unknown;
}): boolean {
  if (args.targetType === 'product') {
    return (
      isPubliclyVisibleModeration(args.productStatus) &&
      args.productArtisanStatus === 'active'
    );
  }
  return args.artisanStatus === 'active';
}