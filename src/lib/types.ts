// WASSILHA shared types

export type Role = 'customer' | 'driver' | 'admin';
export type Lang = 'ar' | 'fr';
export type CargoKey =
  | 'parcel'
  | 'goods'
  | 'shop'
  | 'furniture'
  | 'appliance'
  | 'construction'
  | 'personal'
  | 'other';
export type OrderStatus = 'searching' | 'accepted' | 'picked' | 'delivered' | 'cancelled';

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: Role;
  avatar?: string | null;
}

export interface VehicleRegistrationInfo {
  id: string;
  numeroImmatriculation: string;
  typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
  nom: string | null;
  prenom: string | null;
  raisonSociale: string | null;
  marque: string;
  type: string | null;
  anneePremiereMiseCirculation: number;
}

export interface DriverProfile {
  id: string;
  userId: string;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  // Driver self-registration workflow: the driver can be in one of three
  // application states. "active" means approved and on the platform; "pending"
  // means a self-registered driver waiting for admin review; "rejected" means
  // an admin refused the application (the user can re-apply).
  applicationStatus?: 'active' | 'pending' | 'rejected';
  appliedAt?: string | null;
  reviewedAt?: string | null;
  // Live GPS position (Phase 2 driver tracking). Null until the driver has
  // started broadcasting fixes via /api/driver/location. `lastSeenAt` lets
  // the UI distinguish "stale" drivers (online flag on but no fix in a
  // while) from "fresh" ones — used by the admin fleet map to colour the
  // marker and decide if the driver is "live" vs "offline".
  currentLat?: number | null;
  currentLng?: number | null;
  lastSeenAt?: string | null;
  // Carte grise (vehicle registration) data — null if the driver has not
  // submitted one (e.g. admin-created legacy accounts).
  vehicleRegistration?: VehicleRegistrationInfo | null;
  user: AuthUser;
}

// Compact GPS-only projection of a driver, served by
// /api/admin/drivers/locations. Returned *only* for drivers that are
// currently broadcasting (last fix in the last 10 minutes), so the
// admin fleet map can render a marker without re-asking for the full
// profile (name + phone is enough to label the pin).
export interface AdminDriverLocation {
  id: string;
  name: string;
  phone: string;
  avatar: string | null;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  currentLat: number;
  currentLng: number;
  lastSeenAt: string;
  vehicleLabel: string | null;
}

export interface Order {
  id: string;
  code: string;
  customerId: string;
  driverId: string | null;
  cargoType: CargoKey;
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  weight: number;
  distance: number;
  price: number;
  status: OrderStatus;
  notes: string | null;
  rating: number | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  customer?: AuthUser;
  driver?: AuthUser | null;
}

export interface PricingConfig {
  id: string;
  basePrice: number;
  perKm: number;
  multipliers: Record<CargoKey, number>;
}

export interface AdminStats {
  totalOrders: number;
  activeDrivers: number;
  totalDrivers: number;
  revenue: number;
  avgDelivery: number;
  pendingOrders: number;
  deliveredOrders: number;
  todayOrders: number;
  ordersByStatus: { status: string; count: number }[];
  revenueByDay: { day: string; revenue: number }[];
  cargoBreakdown: { cargo: string; count: number }[];
}

export interface Location {
  lat: number;
  lng: number;
}
