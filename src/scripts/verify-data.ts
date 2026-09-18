// Temporary verification: dump stores + products to confirm existing data intact.
import { PrismaClient } from '@prisma/client';

async function main() {
  const db = new PrismaClient();
  const stores = await db.artisanProfile.findMany({
    select: { displayName: true, slug: true, status: true, rating: true, _count: { select: { products: true } } },
  });
  console.log('STORES=', JSON.stringify(stores));
  const prods = await db.craftProduct.findMany({
    take: 12,
    orderBy: { createdAt: 'desc' },
    select: { nameAr: true, slug: true, isActive: true, price: true, artisan: { select: { slug: true, status: true } } },
  });
  console.log('PRODUCTS=', JSON.stringify(prods));
  const cats = await db.craftCategory.findMany({ select: { nameAr: true, slug: true, isActive: true } });
  console.log('CATEGORIES=', JSON.stringify(cats));
  await db.$disconnect();
}
main();
