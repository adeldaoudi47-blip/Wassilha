'use client';

import Image from 'next/image';
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
        className="relative overflow-hidden rounded-xl shadow-lg"
        style={{ width: size, height: size }}
      >
        <Image
          src="/logo.png"
          alt="Wassilha logo"
          width={size}
          height={size}
          priority
          className="h-full w-full object-cover"
        />
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

