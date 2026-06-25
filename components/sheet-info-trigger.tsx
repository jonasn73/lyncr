"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/** Small (i) control to open a story sheet without stealing primary row actions. */
export function SheetInfoTrigger({
  onPress,
  label = "Learn more",
  className,
  stopPropagation = true,
}: {
  onPress: () => void
  label?: string
  className?: string
  stopPropagation?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        onPress()
      }}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary sm:min-h-8 sm:min-w-8 sm:h-8 sm:w-8",
        className
      )}
      aria-label={label}
    >
      <Info className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}
