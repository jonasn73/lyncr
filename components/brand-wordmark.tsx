"use client"

import { SITE_NAME, SITE_WORDMARK } from "@/lib/brand"
import { cn } from "@/lib/utils"

const SIZE_CLASS = {
  xs: "text-[10px] font-semibold tracking-tight leading-none",
  sm: "text-sm font-semibold tracking-tight",
  md: "text-base font-semibold tracking-tight",
  lg: "text-2xl font-semibold tracking-tight md:text-3xl",
} as const

const VARIANT_CLASS = {
  default: "text-foreground",
  onDark: "text-slate-50",
} as const

export type BrandWordmarkSize = keyof typeof SIZE_CLASS
export type BrandWordmarkVariant = keyof typeof VARIANT_CLASS

/** Logotype: lowercase **lyncr** (`SITE_WORDMARK`). */
export function BrandWordmark({
  size = "md",
  variant = "default",
  className,
}: {
  size?: BrandWordmarkSize
  variant?: BrandWordmarkVariant
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-baseline whitespace-nowrap lowercase",
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className
      )}
      aria-label={SITE_NAME}
    >
      {SITE_WORDMARK}
    </span>
  )
}
