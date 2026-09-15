"use client"

import { memo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { PortingInteractionProvider } from "@/components/dashboard/porting-interaction-context"

export const DashboardPageView = memo(function DashboardPageView({
  children,
  animateEnter = false,
  softEnter = false,
  fill = false,
}: {
  children: ReactNode
  pathname?: string
  /** Tab-click only — never true on hard refresh (opacity-0 placeholder looked like a flash). */
  animateEnter?: boolean
  /** Mild settle for secondary routes (help, inventory) — starts at 0.88, not blank. */
  softEnter?: boolean
  /**
   * Exactly fill `<main>` instead of the usual min-height-and-let-the-page-scroll
   * shape — for routes (Messages) whose content is a fixed-height panel that must
   * never let the outer page scroll. `min-h-*` alone doesn't establish a height for
   * percentage-height children (only `height` does), and bare `overflow-x-hidden`
   * makes the browser auto-promote `overflow-y` to `auto` (the CSS mismatched-axis
   * rule) — both silently broke fill-to-parent layouts, so fill mode avoids both.
   */
  fill?: boolean
}) {
  return (
    <PortingInteractionProvider>
      <div
        className={cn(
          fill
            ? "flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-background px-4 pb-4 pt-4 sm:px-8 sm:pb-6 sm:pt-8"
            : "min-h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h))] w-full max-w-full bg-background px-4 pb-8 pt-4 max-md:min-h-0 max-md:overflow-x-hidden sm:px-8 sm:pb-10 sm:pt-8 md:min-h-[calc(100dvh-4rem)]",
          animateEnter && "animate-sigo-page-enter",
          softEnter && "lyncr-pane-settle"
        )}
      >
        {children}
      </div>
    </PortingInteractionProvider>
  )
})
