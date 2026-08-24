// Thin API client for the WASSILHA frontend. All calls go to relative Next.js API routes.
import type {
  AdminStats,
  AuthUser,
  DriverProfile,
  Order,
  PricingConfig,
} from './types';

async function req<T>(
  url: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  sendOtp: (phone: string) =>
    req<{ ok: boolean; devOtp?: string }>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string, name?: string) =>
    req<{ user: AuthUser }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code, name }),
    }),
  loginAs: (role: 'customer' | 'driver' | 'admin') =>
    req<{ user: AuthUser }>('/api/auth/login-as', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  me: () => req<{ user: AuthUser | null }>('/api/auth/me'),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Pricing
  getPricing: () => req<PricingConfig>('/api/pricing'),
  updatePricing: (data: Partial<PricingConfig>) =>
    req<PricingConfig>('/api/pricing', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Orders
  createOrder: (data: {
    cargoType: string;
    pickup: string;
    dropoff: string;
    weight: number;
    distance: number;
    price: number;
    notes?: string;
    pickupLat?: number;
    pickupLng?: number;
    dropoffLat?: number;
    dropoffLng?: number;
  }) =>
    req<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listOrders: (params?: { role?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.role) q.set('role', params.role);
    if (params?.status) q.set('status', params.status);
    return req<Order[]>(`/api/orders?${q.toString()}`);
  },
  getOrder: (id: string) => req<Order>(`/api/orders/${id}`),
  acceptOrder: (id: string) =>
    req<Order>(`/api/orders/${id}/accept`, { method: 'POST' }),
  rejectOrder: (id: string) =>
    req<{ ok: boolean }>(`/api/orders/${id}/reject`, { method: 'POST' }),
  pickupOrder: (id: string) =>
    req<Order>(`/api/orders/${id}/pickup`, { method: 'POST' }),
  deliverOrder: (id: string) =>
    req<Order>(`/api/orders/${id}/deliver`, { method: 'POST' }),
  cancelOrder: (id: string) =>
    req<Order>(`/api/orders/${id}/cancel`, { method: 'POST' }),
  rateOrder: (id: string, score: number, comment?: string) =>
    req<{ ok: boolean }>(`/api/orders/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ score, comment }),
    }),

  // Driver
  driverProfile: () => req<DriverProfile>('/api/driver/profile'),
  driverStatus: (isOnline: boolean) =>
    req<DriverProfile>('/api/driver/status', {
      method: 'PATCH',
      body: JSON.stringify({ isOnline }),
    }),
  driverEarnings: () =>
    req<{
      total: number;
      thisWeek: number;
      trips: number;
      rating: number;
      recent: Order[];
      weekly: { day: string; earnings: number }[];
    }>('/api/driver/earnings'),
  incomingOrders: () => req<Order[]>('/api/driver/incoming'),

  // Admin
  adminStats: () => req<AdminStats>('/api/admin/stats'),
  adminDrivers: () => req<DriverProfile[]>('/api/admin/drivers'),
  adminOrders: () => req<Order[]>('/api/admin/orders'),
  addDriver: (data: {
    name: string;
    phone: string;
    vehicleType: string;
    vehicleColor: string;
  }) =>
    req<DriverProfile>('/api/admin/drivers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleDriverVerified: (id: string, verified: boolean) =>
    req<DriverProfile>(`/api/admin/drivers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isVerified: verified }),
    }),
};
