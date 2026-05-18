"use client"

import { memo } from "react"
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
        "shrink-0 border-b border-amber-500/40 bg-amber-950/35 backdrop-blur-sm",
        "px-4 py-2.5 sm:px-6 sm:py-3"
      )}
      role="status"
    >
      <p className="mx-auto max-w-7xl text-center text-sm leading-relaxed text-foreground/90 sm:text-left">
        <span aria-hidden className="mr-1">
          ⚠️
        </span>
        Your business line is currently running in sandbox mode. Incoming calls will not route to live phones until
        your line is fully verified.{" "}
        <button
          type="button"
          onClick={activation.openActivateModal}
          className={cn(
            "inline font-semibold text-amber-200/95 underline decoration-amber-400/60 underline-offset-2",
            "transition-colors hover:text-amber-100 hover:decoration-amber-300"
          )}
        >
          Activate Line Now →
        </button>
      </p>
    </div>
  )
})
