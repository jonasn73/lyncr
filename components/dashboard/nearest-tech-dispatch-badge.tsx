"use client"

import { Loader2, Zap } from "lucide-react"
import { formatDistanceMiles } from "@/lib/geo"
import { useNearestTechMatch } from "@/lib/hooks/use-nearest-tech-match"
import { cn } from "@/lib/utils"

type NearestTechDispatchBadgeProps = {
  jobLat: number | null
  jobLng: number | null
  className?: string
}

/** Shows the closest live field tech once a verified service address is selected. */
export function NearestTechDispatchBadge({ jobLat, jobLng, className }: NearestTechDispatchBadgeProps) {
  const { match, loading } = useNearestTechMatch(jobLat, jobLng)
  const hasJobPin = jobLat != null && jobLng != null

  if (!hasJobPin) return null

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-[11px] text-muted-foreground",
          className
        )}
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Checking nearest technician…
      </div>
    )
  }

  if (!match) return null

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
      <p>
        <span className="font-semibold text-emerald-50">Quick dispatch matching:</span>{" "}
        <span className="font-medium text-emerald-50">{match.name}</span> is currently{" "}
        <span className="font-semibold tabular-nums text-emerald-200">{formatDistanceMiles(match.miles)}</span> away.
      </p>
    </div>
  )
}
