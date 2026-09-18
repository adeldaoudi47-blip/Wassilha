// HIRFA Phase 2A — dynamic Open Graph image for a public storefront.
// GET /craft/<storeSlug>/og  →  1200×630 PNG (Arabic-aware via bundled Cairo).
//
// Inactive/pending stores never get an OG image (404), consistent with the
// store page itself. If anything in the render pipeline fails, we redirect to
// the raw store avatar (or the site logo) so a share NEVER shows a broken
// image — OG generation is an enhancement, not a critical path.
import { ImageResponse } from 'next/og';
import { db } from '@/lib/db';
import { CraftOgCard, OG_WIDTH, OG_HEIGHT } from '@/lib/og-card';
import { loadCairoFonts } from '@/lib/og-font';
import { SITE_URL } from '@/lib/site';

export const revalidate = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeSlug: string }> }
) {
  const { storeSlug } = await params;
  try {
    const store = await db.artisanProfile.findFirst({
      where: { slug: storeSlug, status: 'active' },
      select: { displayName: true, bioAr: true, bioFr: true, avatarUrl: true },
    });
    if (!store) {
      return new Response('Not found', { status: 404 });
    }

    try {
      return new ImageResponse(
        (
          <CraftOgCard
            title={store.displayName}
            subtitle={store.bioAr || store.bioFr}
            storeName={null}
            imageUrl={store.avatarUrl}
            brand="ركن حرفة"
            dir="rtl"
          />
        ),
        {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          fonts: loadCairoFonts(),
        }
      );
    } catch (renderErr) {
      console.error('[og/store] render failed, falling back to raw image', renderErr);
      return Response.redirect(store.avatarUrl || `${SITE_URL}/logo.png`);
    }
  } catch (e) {
    console.error('[og/store]', e);
    return Response.redirect(`${SITE_URL}/logo.png`);
  }
}
