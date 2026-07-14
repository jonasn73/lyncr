"use client"

// Small status line shown under a business number (call-flow picker + sidebar active-line card).
// When the line is pinned to the shared Lyncr operator pool we surface "Routing to Pool" so the
// owner sees, at a glance, that this number hands calls to the network instead of their own cell.

import { cn } from "@/lib/utils"
import type { RoutingStrategy } from "@/lib/types"

export function LineRoutingStatus({
  routingStrategy,
  subscriptionActive,
  lineCarrierLive,
  activeCallCount = 0,
  className,
}: {
  routingStrategy: RoutingStrategy
  subscriptionActive: boolean
  lineCarrierLive: boolean
  /** Live inbound legs on this line (Pusher call-initiated → call-completed). */
  activeCallCount?: number
  className?: string
}) {
  const inProgress = activeCallCount > 0

  if (inProgress && lineCarrierLive) {
    const label =
      activeCallCount === 1
        ? "• 1 Active Call In-Progress"
        : `• ${activeCallCount} Active Calls In-Progress`
    return (
      <span
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-1.5 text-[11px] font-semibold text-amber-200/95",
          "break-words [overflow-wrap:anywhere]",
          className
        )}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)]"
          aria-hidden
        />
        {label}
      </span>
    )
  }

  // Pool routing takes priority over raw carrier status — it's the most useful at-a-glance fact.
  if (routingStrategy === "lyncr_only") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-300",
          className
        )}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]"
          aria-hidden
        />
        • Routing to Pool
      </span>
    )
  }
  if (lineCarrierLive) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300/95",
          className
        )}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
          aria-hidden
        />
        • Live & Connected
      </span>
    )
  }
  if (subscriptionActive) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-200/90",
          className
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" aria-hidden />
        • Activating line…
      </span>
    )
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#71717a]", className)}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97706]" aria-hidden />
      • Inactive (Pending Payment)
    </span>
  )
}
