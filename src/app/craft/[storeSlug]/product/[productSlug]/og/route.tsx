// HIRFA Phase 2A — dynamic Open Graph image for a public product.
// GET /craft/<storeSlug>/product/<productSlug>/og  →  1200×630 PNG.
//
// Shows: product name · price (د.ج) · store name · product photo.
// Never shows sensitive data: only the public projection fields are read.
// Falls back to the raw product photo (then the site logo) on render failure.
import { ImageResponse } from 'next/og';
import { db } from '@/lib/db';
import { publicProductGate } from '@/lib/marketplace-moderation';
import { CraftOgCard, OG_WIDTH, OG_HEIGHT } from '@/lib/og-card';
import { loadCairoFonts } from '@/lib/og-font';
import { SITE_URL } from '@/lib/site';

export const revalidate = 300;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ storeSlug: string; productSlug: string }> }
) {
  const { storeSlug, productSlug } = await params;
  try {
    const product = await db.craftProduct.findFirst({
      where: {
        isActive: true,
        ...publicProductGate,
        slug: productSlug,
        artisan: { slug: storeSlug, status: 'active' },
      },
      select: {
        nameAr: true,
        nameFr: true,
        price: true,
        images: true,
        artisan: { select: { displayName: true } },
      },
    });
    if (!product) {
      return new Response('Not found', { status: 404 });
    }

    const price = `${product.price.toLocaleString('fr-DZ')} د.ج`;

    try {
      return new ImageResponse(
        (
          <CraftOgCard
            title={product.nameAr}
            subtitle={null}
            price={price}
            storeName={product.artisan.displayName}
            imageUrl={product.images?.[0] ?? null}
            brand="من ركن حرفة"
            dir="rtl"
          />
        ),
        {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          fonts: await loadCairoFonts(req.url),
        }
      );
    } catch (renderErr) {
      console.error('[og/product] render failed, falling back to raw image', renderErr);
      return Response.redirect(product.images?.[0] || `${SITE_URL}/logo.png`);
    }
  } catch (e) {
    console.error('[og/product]', e);
    return Response.redirect(`${SITE_URL}/logo.png`);
  }
}
