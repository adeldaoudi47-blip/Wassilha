'use client';

import { cn } from '@/lib/utils';

interface BrandLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  variant?: 'light' | 'dark';
}

export function BrandLogo({ size = 40, className, showText = false, variant = 'dark' }: BrandLogoProps) {
  const textColor = variant === 'light' ? '#ffffff' : '#0E6B5E';
  const subColor = variant === 'light' ? 'rgba(255,255,255,0.7)' : '#64748B';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="relative flex items-center justify-center rounded-xl shadow-lg"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, #0E6B5E 0%, #0A4A41 100%)',
        }}
      >
        {/* Triporteur mark */}
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
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
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="text-xl font-extrabold tracking-tight" style={{ color: textColor }}>
            وَصِّلها
          </span>
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: subColor }}>
            WASSILHA
          </span>
        </div>
      )}
    </div>
  );
}
