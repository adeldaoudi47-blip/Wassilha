// Thin API client for the WASSILHA frontend. All calls go to relative Next.js API routes.
import type {
  AdminDriverLocation,
  AdminStats,
  AuthUser,
  DriverProfile,
  MyStoreInfo,
  Order,
  PricingConfig,
  TripOffer,
  TripOfferServiceType,
  CraftCategoryPublic,
  CraftProductListResponse,
  CraftProductPublic,
  CraftArtisanApplication,
  CraftOrderPublic,
  PublicStoreFront,
  PublicProduct,
  PublicProductListResponse,
  PublicStoreTile,
  CraftOrderListResponse,
  CraftOrderCreateResponse,
  CraftOrderStatus,
  CraftStoreStats,
  CraftAreaPublic,
  NotificationListResponse,
} from './types';

async function req<T>(
  url: string,
  opts: RequestInit = {}
): Promise<T> {
  // Do NOT force Content-Type on FormData bodies — the browser must set
  // multipart/form-data with its own boundary, or the API's formData()
  // parse fails with "Content-Type was not one of multipart/form-data".
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        ...(!isFormData && { 'Content-Type': 'application/json' }),
        ...(opts.headers || {}),
      },
      credentials: 'include',
    });
  } catch (e) {
    // Raw transport failure: device is offline, DNS failed, connection was
    // dropped, or a captive portal intercepted the request. Browsers throw
    // a `TypeError: Failed to fetch` (Chrome/WebView) or "NetworkError when
    // attempting to fetch resource" (Firefox) — both are instanceof
    // TypeError. We normalise every flavour to a single stable sentinel so
    // call sites can show a precise offline message instead of "فشل".
    if (e instanceof TypeError) {
      throw new Error('networkError');
    }
    // AbortError (request cancelled) or any other non-network throw:
    // propagate the original so no information is lost.
    throw e;
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {
      // The error body is not JSON — e.g. Vercel returned its HTML error
      // page (500/runtime crash) or a gateway sent an empty body. The
      // generic `Request failed (5xx)` string is meaningless to a driver,
      // so surface a stable sentinel the UI can localise.
      throw new Error('serverError');
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    // 2xx with a non-JSON body (rare: a stray proxy/CDN interception).
    throw new Error('serverError');
  }
}

export const api = {
  // Auth
  sendOtp: (phone: string) =>
    // SECURITY (V?? — OTP bypass lock-down): the server no longer
    // returns the OTP in the response. The shape is `{ ok, sms, provider }`.
    req<{ ok: boolean; sms: boolean; provider: string }>(
      '/api/auth/send-otp',
      {
        method: 'POST',
        body: JSON.stringify({ phone }),
      }
    ),
  verifyOtp: (phone: string, code: string, name?: string) =>
    req<{
      user?: AuthUser;
      requiresSignup?: boolean;
      // Set by /api/auth/verify-otp when it just provisioned the account
      // (auto-create, signup screen removed). The login flow ignores it;
      // the "forgot password" flow uses it to keep refusing unknown phones.
      created?: boolean;
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
  // OPTIONAL PROFILE COMPLETION: updates the logged-in user's name and/or
  // avatar. Always multipart/form-data — the avatar is a real file the server
  // uploads to Vercel Blob; a client-supplied URL is never trusted. On success
  // the server returns the fresh AuthUser so the store can replace it.
  updateMe: (data: FormData) =>
    req<{ user: AuthUser }>('/api/auth/me', { method: 'PATCH', body: data }),
  pendingSignup: () =>
    req<{ pendingSignup: boolean; phone: string | null }>('/api/auth/pending-signup'),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  requestPasswordReset: (phone: string) =>
    // SECURITY (V?? — OTP bypass lock-down): the server no longer
    // returns the OTP in the response. The shape is `{ ok, provider }`.
    req<{ ok: boolean; provider: string }>(
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
    // SCHEDULED BOOKINGS: ISO-8601 string. When omitted / null, the
    // server treats the order as immediate (status='searching').
    // When set to a future time, the server stores status='scheduled'
    // and the order waits for the dispatcher to flip it to
    // 'searching' at the appointed time.
    scheduledAt?: string | null;
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

  // TRIP OFFERS
  // Customer-facing browse: returns up to 50 available future
  // offers. `serviceType` is optional; when omitted the server
  // returns both TAXI and CARGO offers sorted by departure time.
  //
  // The server wraps the result in `{ offers: TripOffer[] }`
  // (see /api/trip-offers/route.ts GET handler), so we unwrap
  // it here. Without this, callers would receive the wrapper
  // object and crash on `offers.length` / `offers.map`.
  listTripOffers: async (params?: { serviceType?: TripOfferServiceType }) => {
    const q = new URLSearchParams();
    if (params?.serviceType) q.set('serviceType', params.serviceType);
    const data = await req<{ offers: TripOffer[] }>(`/api/trip-offers?${q.toString()}`);
    return data.offers;
  },
  // Driver's own offers (any status). Used by the driver "My
  // offers" tab to render an inventory + cancel button. Same
  // wrapper-unwrapping as above.
  listMyTripOffers: async () => {
    const data = await req<{ offers: TripOffer[] }>('/api/trip-offers?mine=1');
    return data.offers;
  },
  // Driver publishes a new offer. All required fields are typed
  // here so a typo at the call site fails the TS build.
  createTripOffer: (data: {
    serviceType: TripOfferServiceType;
    pickup: string;
    dropoff: string;
    scheduledAt: string; // ISO-8601
    price: number;
    seatsAvail?: number;
    cargoType?: string;
  }) =>
    req<TripOffer>('/api/trip-offers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // Driver cancels their own offer. The server flips status to
  // 'cancelled' (soft delete) so the audit trail is preserved.
  cancelTripOffer: (id: string) =>
    req<TripOffer>(`/api/trip-offers/${id}`, { method: 'DELETE' }),
  // Customer books an offer. On success the response carries
  // both the freshly-created `Order` and the updated `TripOffer`
  // (now status='booked'), so the UI can navigate to the order
  // detail view and the offer list re-renders in the same pass.
  bookTripOffer: (id: string) =>
    req<{ order: Order; offer: TripOffer }>(
      `/api/trip-offers/${id}/book`,
      { method: 'POST' },
    ),
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
  // Update the driver's carte-grise (vehicle registration). Returns
  // the updated VehicleRegistrationInfo (matches the shape used inside
  // DriverProfile.vehicleRegistration).
  updateVehicleRegistration: (data: {
    numeroImmatriculation: string;
    marque: string;
    type?: string | null;
    anneePremiereMiseCirculation: number;
    datePremiereMiseEnCirculation?: string | null;
    adresse?: string | null;
    ptac?: string | null;
    // Number of passenger seats — required for TAXI / BOTH service type,
    // null for CARGO. Forwarded to the server unchanged.
    seats?: number | null;
  }) =>
    req<{
      id: string;
      numeroImmatriculation: string;
      typeProprietaire: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
      nom: string | null;
      prenom: string | null;
      raisonSociale: string | null;
      marque: string;
      type: string | null;
      anneePremiereMiseCirculation: number;
      // Returned so the driver profile UI can re-render after a save.
      seats: number | null;
    }>('/api/driver/vehicle', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

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
  // SECURITY (V??): ban / hard-delete hooks. The server is the source
  // of truth — these wrappers exist purely to give the admin UI a
  // typed `api.banDriver()` / `api.deleteDriver()` and to centralise
  // the URL. Any error (403, 404, 409 hasHistory, …) is thrown so the
  // toast layer can surface it.
  banDriver: (id: string) =>
    req<DriverProfile>(`/api/admin/drivers/${id}/reject`, {
      method: 'PATCH',
    }),
  deleteDriver: (id: string) =>
    req<{ ok: true; id: string; userId: string }>(
      `/api/admin/drivers/${id}`,
      {
        method: 'DELETE',
      }
    ),

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
    // Number of passenger seats (TAXI / BOTH). Optional in the wire
    // format — the server validates against the chosen serviceType
    // (CARGO -> null, TAXI/BOTH -> required 1..30).
    seats?: number;
    // Service type — the driver picks which kind(s) of orders they
    // want to receive once approved:
    //   "CARGO"  → original triporteur flow
    //   "TAXI"   → passenger transport (Yassir-like)
    //   "BOTH"   → both
    // Server-side allowed-list coerces unknown values to "CARGO" so
    // a misbehaving client never breaks the registration.
    serviceType?: 'CARGO' | 'TAXI' | 'BOTH';
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
          // Number of passenger seats (TAXI / BOTH) or null for CARGO.
          seats: number | null;
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

  // HIRFA marketplace (craft) - public catalog endpoints (P3)
  getCraftCategories: () => req<CraftCategoryPublic[]>("/api/craft/categories"),
  getCraftProducts: (params?: {
    categoryId?: string;
    artisanId?: string;
    q?: string;
    featured?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    const qp = new URLSearchParams();
    if (params?.categoryId) qp.set("categoryId", params.categoryId);
    if (params?.artisanId) qp.set("artisanId", params.artisanId);
    if (params?.q) qp.set("q", params.q);
    if (params?.featured) qp.set("featured", "1");
    if (params?.page) qp.set("page", String(params.page));
    if (params?.pageSize) qp.set("pageSize", String(params.pageSize));
    const qs = qp.toString();
    return req<CraftProductListResponse>(`/api/craft/products${qs ? `?${qs}` : ""}`);
  },
  getCraftProduct: (id: string) =>
    req<CraftProductPublic>(`/api/craft/products/${id}`),

  // HIRFA (P4): artisan store application + admin review queue
  applyArtisan: (data: {
    displayName: string;
    bio?: string;
    phone?: string;
    areaSlug?: string;
  }) =>
    req<{ ok: boolean; status: "pending"; reapplied?: boolean }>(
      "/api/craft/artisan/apply",
      { method: "POST", body: JSON.stringify(data) }
    ),
  getArtisanApplications: () =>
    req<CraftArtisanApplication[]>("/api/admin/craft/artisans"),
  approveArtisan: (id: string) =>
    req<{ ok: boolean; status: "active" }>(
      `/api/admin/craft/artisans/${id}/approve`,
      { method: "PATCH" }
    ),
  rejectArtisan: (id: string) =>
    req<{ ok: boolean; status: "rejected" }>(
      `/api/admin/craft/artisans/${id}/reject`,
      { method: "PATCH" }
    ),

  // HIRFA (P5): artisan product management + image upload
  createCraftProduct: (data: {
    nameAr: string;
    nameFr?: string;
    descriptionAr?: string;
    descriptionFr?: string;
    price: number;
    categoryId: string;
    images?: string[];
    stock?: number;
    isFeatured?: boolean;
    isMadeToOrder?: boolean;
  }) => req<CraftProductPublic>("/api/craft/products", { method: "POST", body: JSON.stringify(data) }),
  getMyCraftProducts: () => req<CraftProductPublic[]>("/api/craft/products/mine"),
  updateCraftProduct: (id: string, data: Partial<{
    nameAr: string;
    nameFr?: string | null;
    descriptionAr?: string | null;
    descriptionFr?: string | null;
    price: number;
    categoryId: string;
    images: string[];
    stock: number;
    isFeatured: boolean;
    isMadeToOrder?: boolean;
  }>) => req<CraftProductPublic>(`/api/craft/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCraftProduct: (id: string) => req<{ ok: boolean; id: string }>(`/api/craft/products/${id}`, { method: "DELETE" }),
  uploadCraftImage: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ url: string }>("/api/craft/upload", { method: "POST", body: fd });
  },

  // HIRFA (P6): order lifecycle — create, list, status transitions
  createCraftOrder: (data: {
    items: { productId: string; quantity: number }[];
    deliveryOption?: 'pickup' | 'wassilha_delivery';
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    notes?: string;
  }) => req<CraftOrderCreateResponse>("/api/craft/orders", { method: "POST", body: JSON.stringify(data) }),
  getCraftOrders: () =>
    req<CraftOrderListResponse>("/api/craft/orders"),
  updateCraftOrderStatus: (id: string, status: CraftOrderStatus, dropoffAddress?: string, dropoffLat?: number, dropoffLng?: number) =>
    req<CraftOrderPublic>(`/api/craft/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, dropoffAddress, dropoffLat, dropoffLng }),
    }),

  // HIRFA (P7): rate a delivered craft order
  rateCraftOrder: (id: string, score: number, comment?: string) =>
    req<{ ok: boolean; message: string }>(`/api/craft/orders/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score, comment }),
    }),

  // HIRFAA Phase 1 (Marketplace): PUBLIC store-front queries.
  // These hit the read-only public endpoints (no auth required).
  getStoreFront: (slug: string) =>
    req<PublicStoreFront>(`/api/craft/stores/${encodeURIComponent(slug)}`),
  getProductBySlug: (storeSlug: string, productSlug: string) =>
    req<PublicProduct>(`/api/craft/stores/${encodeURIComponent(storeSlug)}/product/${encodeURIComponent(productSlug)}`),
  listMarketplaceProducts: (params?: { featured?: true; page?: number; pageSize?: number }) => {
    const qp = new URLSearchParams();
    if (params?.featured) qp.set('featured', '1');
    if (params?.page) qp.set('page', String(params.page));
    if (params?.pageSize) qp.set('pageSize', String(params.pageSize));
    const qs = qp.toString();
    return req<PublicProductListResponse>(`/api/craft/marketplace/products${qs ? `?${qs}` : ''}`);
  },
  listMarketplaceStores: () =>
    req<PublicStoreTile[]>(`/api/craft/marketplace/stores`),

  // HIRFAA Phase 1: the logged-in artisan's own store info (for the
  // "متجري / My store" share section in the dashboard).
  getMyStore: () => req<MyStoreInfo>("/api/craft/artisan/me"),
  // HIRFA (P8): optional store profile edit — display name + store avatar.
  // Multipart so the avatar is uploaded as a real file (Vercel Blob); a
  // client-supplied URL is never accepted. Returns the fresh store info.
  updateMyStore: (data: FormData) =>
    req<MyStoreInfo>("/api/craft/artisan/me", { method: "PATCH", body: data }),
  // HIRFA Phase 2A: the artisan's own REAL analytics totals (never faked).
  getMyStoreStats: () => req<CraftStoreStats>("/api/craft/artisan/me/stats"),
  // HIRFA Phase 2A: public delivery areas for the search "Area" filter.
  getCraftAreas: () => req<CraftAreaPublic[]>("/api/craft/areas"),
  // HIRFA Phase 2A: anonymous event tracking (page views / shares). Fire and
  // forget at the call sites; the endpoint is PII-free.
  trackCraftEvent: (payload: { type: string; storeId?: string; productId?: string }) =>
    req<{ ok: boolean }>("/api/craft/analytics", { method: "POST", body: JSON.stringify(payload) }),

  // In-app notification center (Phase 1): the signed-in user's own
  // notifications. Every call is session-scoped server-side, so a client can
  // never reach another user's center.
  getNotifications: (params?: { page?: number; pageSize?: number; unreadOnly?: boolean }) => {
    const qp = new URLSearchParams();
    if (params?.page) qp.set('page', String(params.page));
    if (params?.pageSize) qp.set('pageSize', String(params.pageSize));
    if (params?.unreadOnly) qp.set('unreadOnly', '1');
    const qs = qp.toString();
    return req<NotificationListResponse>(`/api/notifications${qs ? `?${qs}` : ''}`);
  },
  // Cheapest possible badge refresh: returns only the count, no rows.
  getUnreadNotificationCount: () =>
    req<{ unreadCount: number }>('/api/notifications/unread-count'),
  // Marks one notification read (or unread when isRead=false).
  markNotificationRead: (id: string, isRead = true) =>
    req<{ ok: boolean; id: string; isRead: boolean }>(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead }),
    }),
  // Marks every unread notification of the caller as read ("Mark all read").
  markAllNotificationsRead: () =>
    req<{ ok: boolean; updated: number }>('/api/notifications/read-all', { method: 'POST' }),
};