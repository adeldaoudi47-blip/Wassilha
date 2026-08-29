import { ImageResponse } from 'next/og';

// Favicon = official BrandLogo (the same triporteur mark used on the
// Onboarding/splash screen and every app header).
// Replaces the previous Z.ai placeholder that showed a blue "Z" in the
// browser tab.
// Source of truth: src/components/wassilha/brand-logo.tsx
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #0E6B5E 0%, #0A4A41 100%)',
          borderRadius: 6,
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          width="22"
          height="22"
        >
          <path
            d="M3 17h13.5a1.5 1.5 0 0 0 0-3H7l2-5h7.5"
            stroke="#FFB778"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="18.5" r="2" fill="#ffffff" />
          <circle cx="17" cy="18.5" r="2" fill="#ffffff" />
          <rect x="15" y="7" width="4" height="4" rx="1" fill="#FF7A00" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
