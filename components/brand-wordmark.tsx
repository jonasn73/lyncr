"use client"

import { SITE_NAME } from "@/lib/brand"
import { cn } from "@/lib/utils"

const SIZE_CLASS = {
  xs: {
    hey: "text-[10px] font-extralight tracking-[0.14em] leading-none",
    sigo: "text-[10px] font-bold tracking-tight leading-none",
  },
  sm: {
    hey: "text-sm font-extralight tracking-[0.11em]",
    sigo: "text-sm font-bold tracking-tight",
  },
  md: {
    hey: "text-base font-extralight tracking-[0.1em]",
    sigo: "text-base font-bold tracking-tight",
  },
  lg: {
    hey: "text-2xl font-extralight tracking-[0.09em] md:text-3xl",
    sigo: "text-2xl font-bold tracking-tight md:text-3xl",
  },
} as const

const VARIANT_CLASS = {
  default: {
    hey: "text-foreground/72",
    sigo: "text-foreground",
  },
  onDark: {
    hey: "text-violet-200/88",
    sigo: "text-slate-50",
  },
} as const

export type BrandWordmarkSize = keyof typeof SIZE_CLASS
export type BrandWordmarkVariant = keyof typeof VARIANT_CLASS

/**
 * Logotype for **HeySigo**: thin “Hey”, bold “Sigo”, read as one word (`SITE_NAME`).
 */
export function BrandWordmark({
  size = "md",
  variant = "default",
  className,
}: {
  size?: BrandWordmarkSize
  variant?: BrandWordmarkVariant
  className?: string
}) {
  const s = SIZE_CLASS[size]
  const v = VARIANT_CLASS[variant]
  return (
    <span
      className={cn("inline-flex select-none items-baseline whitespace-nowrap", className)}
      aria-label={SITE_NAME}
    >
      <span className={cn(s.hey, v.hey)}>Hey</span>
      <span className={cn(s.sigo, v.sigo, "-ml-px")}>Sigo</span>
    </span>
  )
}
