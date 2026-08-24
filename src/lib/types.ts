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

export interface DriverProfile {
  id: string;
  userId: string;
  vehicleType: string;
  vehicleColor: string;
  plateNumber: string | null;
  licenseNumber: string | null;
  isOnline: boolean;
  isVerified: boolean;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  user: AuthUser;
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
