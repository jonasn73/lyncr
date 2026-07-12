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
        "fixed bottom-[88px] left-4 right-4 bg-slate-900 border border-emerald-500/40 p-3 rounded-xl shadow-2xl z-40 flex items-center justify-between cursor-pointer",
        "md:left-auto md:right-6 md:w-[min(100%,22rem)]",
        "touch-manipulation transition-transform active:scale-[0.99]",
        className
      )}
      aria-label={`Expand active intake for ${phoneDisplay}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="truncate text-sm font-medium text-slate-100">
          Active Intake: {phoneDisplay}
        </span>
      </div>
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        aria-hidden
      >
        <ChevronUp className="h-4 w-4" />
      </span>
    </button>
  )
}
