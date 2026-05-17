"use client"

import { cn } from "@/lib/utils"

type BrandMarkProps = {
  className?: string
  /** When false, exposes the mark to assistive APIs (use if no parent label). */
  decorative?: boolean
}

/** lyncr monogram: lowercase **l** stem — reads at favicon and header sizes. */
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
        <rect x="8.25" y="5.5" width="2.35" height="13" rx="1.15" fill="currentColor" />
        <path
          fill="currentColor"
          d="M8.42 18.5h7.35c.95 0 1.55.52 1.55 1.35 0 .88-.68 1.4-1.78 1.4H8.42V18.5z"
          opacity={0.92}
        />
      </g>
    </svg>
  )
}
