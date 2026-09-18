// HIRFA Phase 2A — shared JSX template for dynamic OG images.
//
// Uses next/og's ImageResponse (Satori under the hood) with the bundled Cairo
// TTFs (see lib/og-font.ts) so ARABIC text renders correctly instead of tofu.
//
// Layout: 1200×630, brand gradient, product/store image on one side (or a
// decorative panel when there is no image), title + subtitle + brand mark.
import { loadCairoFonts } from './og-font';
import { SITE_URL } from './site';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgCardProps {
  title: string;
  subtitle?: string | null;
  /** e.g. "2 500 د.ج" — rendered big and bold for products. */
  price?: string | null;
  /** Store name shown under the title on product cards. */
  storeName?: string | null;
  imageUrl?: string | null;
  /** "ركن حرفة" branding line shown at the bottom. */
  brand: string;
  dir?: 'rtl' | 'ltr';
}

const BRAND_GRADIENT = 'linear-gradient(135deg, #0B4F45 0%, #0E6B5E 55%, #12947F 100%)';

/**
 * Pure JSX (no ImageResponse here) so both the store and product OG routes can
 * reuse the exact same visual language.
 */
export function CraftOgCard({
  title,
  subtitle,
  price,
  storeName,
  imageUrl,
  brand,
  dir = 'rtl',
}: OgCardProps) {
  const rtl = dir === 'rtl';
  const showImage = Boolean(imageUrl);
  const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: rtl ? 'row-reverse' : 'row',
        background: BRAND_GRADIENT,
        color: '#FFFFFF',
        fontFamily: 'Cairo',
        padding: 56,
        gap: 48,
        position: 'relative',
      }}
    >
      {/* Image side (or a branded monogram tile when there is no photo) */}
      {showImage ? (
        <img
          src={imageUrl as string}
          alt=""
          style={{
            width: 420,
            height: 518,
            objectFit: 'cover',
            borderRadius: 32,
            boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 420,
            height: 518,
            borderRadius: 32,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.10)',
            border: '2px solid rgba(255,255,255,0.22)',
            fontSize: 180,
          }}
        >
          🧶
        </div>
      )}

      {/* Text side */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flex: 1,
          minWidth: 0,
          alignItems: rtl ? 'flex-end' : 'flex-start',
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
            flexDirection: rtl ? 'row-reverse' : 'row',
          }}
        >
          <div
            style={{
              background: 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.30)',
              borderRadius: 999,
              padding: '8px 22px',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {brand}
          </div>
        </div>

        <div
          style={{
            fontSize: price ? 58 : 68,
            fontWeight: 900,
            lineHeight: 1.15,
            maxWidth: 640,
            wordBreak: 'break-word',
          }}
        >
          {clamp(title, 46)}
        </div>

        {price ? (
          <div style={{ fontSize: 52, fontWeight: 900, marginTop: 16, color: '#FFD57A' }}>
            {price}
          </div>
        ) : null}

        {storeName ? (
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 18, opacity: 0.95 }}>
            {clamp(storeName, 40)}
          </div>
        ) : null}

        {subtitle ? (
          <div
            style={{
              fontSize: 28,
              fontWeight: 400,
              marginTop: 18,
              opacity: 0.88,
              maxWidth: 620,
              lineHeight: 1.35,
            }}
          >
            {clamp(subtitle, 96)}
          </div>
        ) : null}
      </div>

      {/* Footer brand bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 56,
          right: 56,
          display: 'flex',
          flexDirection: rtl ? 'row-reverse' : 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 24,
          opacity: 0.75,
        }}
      >
        <span style={{ fontWeight: 900 }}>وَصِّلها · WASSILHA</span>
        <span style={{ fontWeight: 400 }}>{ogHost()}</span>
      </div>
    </div>
  );
}

/** Host shown in the OG footer — derived from the configured site URL. */
function ogHost(): string {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return 'WASSILHA';
  }
}
