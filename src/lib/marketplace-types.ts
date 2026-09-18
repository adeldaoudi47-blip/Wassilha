// HIRFAA Phase 1 — shared TS types for public marketplace pages.
// Mirrors the runtime shape produced by db.select(...) in the pages above.
export interface ProductTile {
  id: string;
  slug: string | null;
  nameAr: string;
  nameFr: string | null;
  price: number;
  images: string[];
  stock: number;
  isFeatured: boolean;
  createdAt: Date;
  category: { id: string; nameAr: string; nameFr: string | null; slug: string | null } | null;
  artisan: {
    id: string;
    slug: string | null;
    displayName: string;
    avatarUrl: string | null;
    rating: number;
    totalSales: number;
    area: { nameAr: string; nameFr: string | null } | null;
  };
}

export interface StoreFront {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bioAr: string | null;
  bioFr: string | null;
  slug: string | null;
  rating: number;
  totalSales: number;
  area: { nameAr: string; nameFr: string | null } | null;
  products: ProductTile[];
  productCount: number;
}
