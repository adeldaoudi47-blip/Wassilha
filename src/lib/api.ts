// Thin API client for the WASSILHA frontend. All calls go to relative Next.js API routes.
import type {
  AdminDriverLocation,
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
    req<{
      user?: AuthUser;
      requiresSignup?: boolean;
      phone?: string;
      // Set by /api/auth/verify-otp when the phone belongs to a driver whose
      // application has not yet been approved. The frontend uses these flags
      // to display the "pending" or "rejected" screen instead of issuing a
      // session. SECURITY: the server still refuses to set a session.
      driverApplicationPending?: boolean;
      driverApplicationRejected?: boolean;
    }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code, name }),
    }),
  completeSignup: (data: { name: string; email: string; password: string; confirmPassword: string }) =>
    req<{ user: AuthUser }>('/api/auth/complete-signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (email: string, password: string) =>
    req<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  loginAs: (role: 'customer' | 'driver' | 'admin') =>
    req<{ user: AuthUser }>('/api/auth/login-as', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  me: () => req<{ user: AuthUser | null }>('/api/auth/me'),
  pendingSignup: () =>
    req<{ pendingSignup: boolean; phone: string | null }>('/api/auth/pending-signup'),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  requestPasswordReset: (phone: string) =>
    req<{ ok: boolean; devOtp?: string }>(
      '/api/auth/forgot-password/request',
      { method: 'POST', body: JSON.stringify({ phone }) }
    ),
  resetPassword: (data: { code: string; password: string; confirmPassword: string }) =>
    req<{ user: AuthUser }>('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

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
    // `weight` is optional. The cargo UI sends a real number
    // (1..500 kg), but the new passenger-transport mode (`cargoType
    // = 'taxi'`) doesn't have a weight slider at all — the client
    // simply omits the field and the server falls back to a neutral
    // default. We type the param as `number | undefined` so the
    // call site is honest about that.
    weight?: number;
    // `distance` and `price` are recomputed server-side from the
    // coordinates (see V7 in src/lib/pricing.ts), so the client
    // value is informational only. Both are optional in the
    // payload — the server will overwrite them with the canonical
    // Haversine-based values.
    distance?: number;
    price?: number;
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
  adminDriverLocations: () =>
    req<AdminDriverLocation[]>('/api/admin/drivers/locations'),
  adminOrders: () => req<Order[]>('/api/admin/orders'),
  // Delete an order. The same endpoint is reused for both customer
  // and admin paths; authorization is enforced server-side per the
  // role-aware logic in /api/orders/[id]/route.ts.
  deleteOrder: (id: string) =>
    req<{ ok: true }>(`/api/orders/${id}`, { method: 'DELETE' }),
  addDriver: (data: {
    name: string;
    phone: string;
    vehicleType: string;
    vehicleColor: string;
    numeroImmatriculation?: string;
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

  // Driver self-registration (admin approval required before activation)
  applyDriver: (data: {
    name: string;
    numeroImmatriculation: string;
    typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
    nom?: string;
    prenom?: string;
    raisonSociale?: string;
    marque: string;
    type?: string;
    anneePremiereMiseCirculation: number;
    // Carte grise extended fields (all optional).
    datePremiereMiseEnCirculation?: string;
    adresse?: string;
    ptac?: string;
    poidsAVide?: string;
    energie?: string;
    puissance?: string;
  }) =>
    req<{ ok: boolean; status: 'pending' }>('/api/auth/apply-driver', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  driverApplications: () =>
    req<
      {
        id: string;
        userId: string;
        name: string;
        phone: string;
        applicationStatus: 'pending' | 'rejected';
        appliedAt: string | null;
        reviewedAt: string | null;
        createdAt: string;
        vehicleRegistration: {
          id: string;
          numeroImmatriculation: string;
          typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
          nom: string | null;
          prenom: string | null;
          raisonSociale: string | null;
          marque: string;
          type: string | null;
          anneePremiereMiseCirculation: number;
          // Carte grise extended fields (all nullable).
          datePremiereMiseEnCirculation: string | null;
          adresse: string | null;
          ptac: string | null;
          poidsAVide: string | null;
          energie: string | null;
          puissance: string | null;
        } | null;
      }[]
    >('/api/admin/driver-applications'),
  approveDriver: (id: string) =>
    req<DriverProfile>(`/api/admin/drivers/${id}/approve`, {
      method: 'PATCH',
    }),
  rejectDriver: (id: string) =>
    req<DriverProfile>(`/api/admin/drivers/${id}/reject`, {
      method: 'PATCH',
    }),
};