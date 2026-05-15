"use client"

import { cn } from "@/lib/utils"

type BrandMarkProps = {
  className?: string
  /** When false, exposes the mark to assistive APIs (use if no parent label). */
  decorative?: boolean
}

/**
 * HeySigo monogram: thin **H** (two stems + crossbar) + filled **S** — reads at favicon and header sizes.
 */
export function BrandMark({ className, decorative = true }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      fill="none"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? "presentation" : "img"}
    >
      <g className="text-current">
        {/* Thin H: left stem */}
        <rect x="4.35" y="5.65" width="1.85" height="12.7" rx="0.92" fill="currentColor" opacity={0.92} />
        {/* Thin H: crossbar */}
        <rect x="4.35" y="10.95" width="6.35" height="1.9" rx="0.45" fill="currentColor" opacity={0.92} />
        {/* Thin H: right stem (lighter weight) */}
        <rect x="8.85" y="5.65" width="1.35" height="12.7" rx="0.67" fill="currentColor" opacity={0.42} />
        {/* Bold S */}
        <path
          fill="currentColor"
          d="M13.05 6.85h4.95c2.35 0 3.85 1.15 3.85 2.95 0 1.45-.75 2.45-2.2 2.85l-.12.1c1.55.35 2.52 1.35 2.52 2.95 0 2.05-1.62 3.35-4.32 3.35h-4.68v-1.85h4.45c1.38 0 2.22-.55 2.22-1.55s-.82-1.58-2.38-1.58h-2.7v-1.75h2.28c1.28 0 2.02-.55 2.02-1.48s-.78-1.48-2.12-1.48h-4.55V6.85z"
        />
      </g>
    </svg>
  )
}
