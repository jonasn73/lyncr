"use client"

// Manual-intake job-type picker for non-locksmith trades (087). Deliberately simple —
// no sector tabs, no pricing breakdown (locksmith's ServiceQuoteCalculatorPanel keeps those,
// unchanged, for locksmith accounts only). Options come from lib/job-intake-registry.ts,
// the same trade-specific categories already used by the AI phone script.

import { cn } from "@/lib/utils"
import { resolveJobIntakeOptions } from "@/lib/job-intake-registry"

type IndustryJobTypeSelectorProps = {
  industry: string | null | undefined
  /** Empty string = no selection yet. */
  serviceTypeId: string
  onServiceTypeChange: (id: string) => void
  compact?: boolean
}

export function IndustryJobTypeSelector({
  industry,
  serviceTypeId,
  onServiceTypeChange,
  compact,
}: IndustryJobTypeSelectorProps) {
  const options = resolveJobIntakeOptions(industry)

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const active = serviceTypeId === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onServiceTypeChange(option.id)}
            className={cn(
              "rounded-lg border px-3 py-4 text-left text-sm font-semibold transition-colors",
              compact && "px-3 py-3",
              active
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-card/40 text-foreground hover:bg-muted/50"
            )}
            aria-pressed={active}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
