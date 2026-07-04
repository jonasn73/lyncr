"use client"

// Live KPI banner for the dispatch scheduler — contained on mobile to avoid horizontal clip.

import { memo, useMemo } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { computeDispatchOperationsMetrics } from "@/lib/dispatch-operations-metrics"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type MetricCellProps = {
  label: string
  value: number
  valueClassName?: string
  className?: string
}

function MetricCell({
  label,
  value,
  valueClassName,
  className,
  compact = false,
}: MetricCellProps & { compact?: boolean }) {
  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-1",
          className
        )}
      >
        <span className="text-[10px] font-medium text-zinc-500">{label}</span>
        <span className={cn("text-xs font-bold tabular-nums", valueClassName)}>{value}</span>
      </div>
    )
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="truncate text-xs font-medium text-zinc-400">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums text-zinc-100", valueClassName)}>{value}</span>
    </div>
  )
}

function MetricDivider() {
  return <div className="hidden h-4 w-px shrink-0 bg-zinc-800 md:block" aria-hidden />
}

export const DispatchOperationsMetricStrip = memo(function DispatchOperationsMetricStrip({
  poolJobs,
  activePipelineJobs,
  dayEvents,
  className,
  /** When true, skip page-padding bleed (e.g. inside scheduler mobile overlay). */
  embedded = false,
  /** Pill chips for the mobile map toolbar. */
  compact = false,
}: {
  poolJobs: UnassignedPoolJob[]
  activePipelineJobs: ActivePipelineJob[]
  dayEvents: SchedulerEvent[]
  className?: string
  embedded?: boolean
  compact?: boolean
}) {
  const isMobile = useIsMobile()
  const showPillRow = compact
  const useShortLabels = showPillRow || isMobile
  const inboundCallPanel = useInboundCallPanelOptional()
  const metrics = useMemo(
    () =>
      computeDispatchOperationsMetrics({
        poolJobs,
        activePipelineJobs,
        dayEvents,
      }),
    [poolJobs, activePipelineJobs, dayEvents]
  )

  return (
    <div className={cn("min-w-0", className)} aria-label="Live dispatch operations summary">
      <div
        className={cn(
          showPillRow
            ? "flex flex-nowrap gap-1.5 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2 md:grid-cols-4 md:gap-4 md:px-8 md:py-3",
          !showPillRow && !embedded && "border-b border-zinc-800 bg-zinc-900/90 backdrop-blur"
        )}
      >
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Active" : "Active Dispatches"}
          value={metrics.activeDispatches}
          valueClassName="text-sky-300"
        />
        {!showPillRow ? <MetricDivider /> : null}
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Pool" : "Unassigned Pool"}
          value={metrics.unassignedPool}
          valueClassName="text-amber-300"
        />
        {!showPillRow ? <MetricDivider /> : null}
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "On-site" : "On-Site"}
          value={metrics.onSite}
          valueClassName="text-yellow-300"
        />
        {!showPillRow ? <MetricDivider /> : null}
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Done" : "Completed Today"}
          value={metrics.completedToday}
          valueClassName="text-zinc-400"
        />
        {showPillRow && inboundCallPanel ? (
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 snap-start gap-1.5 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground"
            onClick={() => inboundCallPanel.openManualCallPanel()}
          >
            <Plus className="h-3 w-3" aria-hidden />
            Manual
          </Button>
        ) : null}
      </div>
      {!showPillRow && inboundCallPanel ? (
        <div className={cn("px-3 pb-2 md:px-8", !embedded && "border-b border-zinc-800 bg-zinc-900/90 backdrop-blur md:pb-3")}>
          <Button
            type="button"
            size="sm"
            className="h-9 w-full gap-1.5 font-semibold bg-primary text-primary-foreground shadow-md hover:bg-primary/90 md:w-auto"
            onClick={() => inboundCallPanel.openManualCallPanel()}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Manual call
          </Button>
        </div>
      ) : null}
    </div>
  )
})
