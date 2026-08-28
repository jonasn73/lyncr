"use client"

// Compact floating PiP tray when the intake sheet is minimized.

import { ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export function IntakePipTray({
  phoneDisplay,
  onExpand,
  className,
}: {
  phoneDisplay: string
  onExpand: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        // Above Leaflet panes (~400–1000) + Map chrome — same trap as Return-to-Intake.
        "fixed bottom-[88px] left-4 right-4 z-[6200] flex cursor-pointer items-center justify-between rounded-xl border border-success/40 bg-card p-3 shadow-overlay",
        "md:left-auto md:right-6 md:w-[min(100%,22rem)]",
        "touch-manipulation transition-transform active:scale-[0.99]",
        className
      )}
      aria-label={`Expand active intake for ${phoneDisplay}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          Active Intake: {phoneDisplay}
        </span>
      </div>
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success/10 text-success"
        aria-hidden
      >
        <ChevronUp className="h-4 w-4" />
      </span>
    </button>
  )
}
