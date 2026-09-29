// ---------------------------------------------------------------------------
// NEGOTIATION ENGINE (Phase 4) — server-side gate for every driver who wants
// to put a price on an order.
//
// Before Phase 4 the driver-side offer POST only checked "account is active"
// + "order is negotiable". That let a non-verified driver, a TAXI-only
// driver, or a motorbike send (and, once the customer accepted, WIN) offers
// on orders they could physically not serve — the same class of hole the
// P1/P2 vehicle-matching work closed on the flat-accept path. This module is
// the single source of truth the offer endpoints call so the rules live in
// one place and unit tests (src/scripts/verify-phase4.ts) can exercise them
// without a database.
// ---------------------------------------------------------------------------
import { serviceCategoryFor, isVehicleCompatible } from './dispatch';

/** The order facts the gate needs (selected from `Order`). */
export interface OfferOrderFacts {
  status: string;
  customerId: string;
  driverId: string | null;
  cargoType: string;
  isNegotiable?: boolean;
  requiredVehicleType?: string | null;
  requiredSeats?: number | null;
  cargoSize?: string | null;
}

/** The driver facts the gate needs (User + Driver + VehicleRegistration). */
export interface OfferDriverFacts {
  id: string;
  isVerified: boolean;
  applicationStatus: string;
  serviceType: string;
  vehicleCategory?: string | null;
  seats?: number | null;
}

export type OfferDenialReason =
  | 'orderNotSearchable'
  | 'orderNotNegotiable'
  | 'ownOrder'
  | 'alreadyAssigned'
  | 'notVerified'
  | 'driverNotActive'
  | 'serviceTypeMismatch'
  | 'vehicleNotCompatible';

export type OfferGateResult = { ok: true } | { ok: false; reason: OfferDenialReason; status: number };

/**
 * Can this driver send an offer on this order?
 *
 * Deliberately mirrors the flat-accept policy so "offer" and "accept" never
 * disagree about who may serve an order:
 *   - the order must be live (`searching`) and negotiable;
 *   - the customer cannot offer on their own order, and an order that
 *     already has a driver is closed for offers;
 *   - the driver must be verified + approved (`active`), mirroring accept;
 *   - service type must cover the order's service (TAXI-only drivers stay
 *     out of cargo negotiation; `serviceCategoryFor` keeps the door open
 *     if offers ever expand to passengers);
 *   - the registered vehicle must satisfy `isVehicleCompatible` — including
 *     the new Phase 4 cargoSize rule (large shipments never go to a moto).
 *
 * Online status is NOT required: a driver may queue an offer for the
 * customer to accept later, which is exactly what Phase 3 allowed.
 */
export function canDriverOfferOnOrder(
  order: OfferOrderFacts,
  driver: OfferDriverFacts,
): OfferGateResult {
  if (order.status !== 'searching') return { ok: false, reason: 'orderNotSearchable', status: 409 };
  if (!order.isNegotiable) return { ok: false, reason: 'orderNotNegotiable', status: 403 };
  if (order.customerId === driver.id) return { ok: false, reason: 'ownOrder', status: 403 };
  if (order.driverId) return { ok: false, reason: 'alreadyAssigned', status: 409 };

  if (!driver.isVerified) return { ok: false, reason: 'notVerified', status: 403 };
  if (driver.applicationStatus !== 'active') {
    return { ok: false, reason: 'driverNotActive', status: 403 };
  }

  const requiredService = serviceCategoryFor(order.cargoType);
  // BOTH retired 2026-09-28: a driver serves exactly one service type, and the
  // vehicle gate below (isVehicleCompatible) is what really decides capability.
  if (driver.serviceType !== requiredService) {
    return { ok: false, reason: 'serviceTypeMismatch', status: 403 };
  }

  if (!isVehicleCompatible(order, { vehicleCategory: driver.vehicleCategory, seats: driver.seats })) {
    return { ok: false, reason: 'vehicleNotCompatible', status: 403 };
  }

  return { ok: true };
}

/**
 * True when `cargoImageUrl` is safe to store on an order: an https URL on
 * Vercel Blob's public host (the only uploader that writes the file the URL
 * points to). Blocks arbitrary / javascript: URLs and links to external
 * trackers being reflected to every driver that views the request.
 */
export function isAllowedCargoImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return (
    parsed.hostname === 'public.blob.vercel-storage.com' ||
    parsed.hostname.endsWith('.public.blob.vercel-storage.com')
  );
}