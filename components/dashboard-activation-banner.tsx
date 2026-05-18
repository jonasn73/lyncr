"use client"

import { memo } from "react"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"

export const DashboardActivationBanner = memo(function DashboardActivationBanner() {
  const activation = useDashboardActivationOptional()
  if (!activation || activation.loading || activation.subscriptionActive) {
    return null
  }
  if (!activation.reservedDisplay) {
    return null
  }

  return (
    <div
      className={cn(
        "border-b border-amber-500/35 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent",
        "px-4 py-3 sm:px-6"
      )}
      role="status"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-snug text-foreground/95">
          <span aria-hidden className="mr-1.5">
            ⚠️
          </span>
          Your business line is currently in sandbox trial mode. Click &apos;Activate Line&apos; to launch your live
          Telnyx phone routing and unlock inbound calling.
        </p>
        <button
          type="button"
          onClick={activation.openActivateModal}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5",
            "text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)]",
            "transition-colors hover:bg-primary/90"
          )}
        >
          <Zap className="h-4 w-4" aria-hidden />
          Activate Line
        </button>
      </div>
    </div>
  )
})
