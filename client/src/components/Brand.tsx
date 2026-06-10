"use client";

import { useId } from "react";

/**
 * Findec brand lockup — a crisp, transparent vector recreation of the logo
 * (gradient angular "F" mark + "Findec" wordmark). Single source of truth for
 * branding across the app. To use an exact raster instead, drop a file at
 * client/public/logo.png and swap the <svg> for <img src="/logo.png" />.
 */
export default function Brand({
  size = 30,
  showWordmark = true,
  className = "",
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  const raw = useId().replace(/[:]/g, "");
  const m = `fdm-${raw}`;
  const c = `fdc-${raw}`;
  return (
    <span className={`fd-brand ${className}`.trim()} aria-label="Findec">
      <svg
        className="fd-brand-mark"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role="img"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={m} x1="10" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3ad7ff" />
            <stop offset="0.5" stopColor="#2b8cff" />
            <stop offset="1" stopColor="#1b46c8" />
          </linearGradient>
          <linearGradient id={c} x1="16" y1="38" x2="26" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#5ef0ff" />
            <stop offset="1" stopColor="#1fb6e6" />
          </linearGradient>
        </defs>
        {/* top arm */}
        <path d="M12 7 L55 7 L45 19 L22 19 Z" fill={`url(#${m})`} />
        {/* stem */}
        <path d="M12 7 L24 7 L24 57 L12 57 Z" fill={`url(#${m})`} />
        {/* middle arm */}
        <path d="M24 25 L46 25 L38 37 L24 37 Z" fill={`url(#${m})`} />
        {/* bright cyan accent on the lower stem */}
        <path d="M16 39 L24 39 L24 57 L16 57 Z" fill={`url(#${c})`} />
        {/* plus accent */}
        <path d="M50 23 H58 M54 19 V27" stroke="#5ef0ff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      {showWordmark && <span className="fd-brand-word">Findec</span>}
    </span>
  );
}
