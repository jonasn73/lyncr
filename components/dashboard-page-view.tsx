"use client"

// ============================================
// Stable frame for dashboard tab content
// ============================================
// Avoid `key={pathname}` on workspace tabs — remounting caused layout stutter. Enter
// animation runs only for Routing and other non-cached routes (see `animateEnter`).

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

export function DashboardPageView({
  children,
  animateEnter = false,
}: {
  children: ReactNode
  /** Legacy prop — pathname is unused; kept so callers need not churn. */
  pathname?: string
  /** Page-enter keyframes (Routing, Help, etc.) — off for cached workspace tabs. */
  animateEnter?: boolean
}) {
  return (
    <div
      className={cn(
        "min-h-[calc(100dvh-7.5rem)] w-full bg-background px-5 pb-28 pt-5 sm:px-8 sm:pb-32 sm:pt-8",
        animateEnter && "animate-sigo-page-enter"
      )}
    >
      {children}
    </div>
  )
}
