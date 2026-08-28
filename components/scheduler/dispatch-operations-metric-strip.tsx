"use client"

// Live KPI banner for the dispatch scheduler — number-first tiles, quiet zeros.

import { memo, useMemo } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { computeDispatchOperationsMetrics } from "@/lib/dispatch-operations-metrics"
import { useAnimatedNumber } from "@/lib/hooks/use-animated-number"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type MetricCellProps = {
  label: string
  value: number
  /** Accent color when the count is non-zero. */
  valueClassName?: string
  className?: string
  compact?: boolean
  /** Reserve digit space without painting a misleading 0. */
  pending?: boolean
}

function MetricCell({
  label,
  value,
  valueClassName,
  className,
  compact = false,
  pending = false,
}: MetricCellProps) {
  // Zero counts stay muted so non-zero KPIs pop as the signal.
  const isZero = !pending && value === 0
  const rolled = useAnimatedNumber(value)
  const display = pending ? "\u00a0" : rolled

  // Compact map toolbar — horizontal pill chip.
  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex shrink-0 snap-start items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3 py-1",
          className
        )}
      >
        <span className="text-micro font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "min-w-[0.75rem] text-xs font-bold tabular-nums",
            isZero || pending ? "text-muted-foreground" : valueClassName
          )}
        >
          {display}
        </span>
      </div>
    )
  }

  // Number-first tile — tabular digit, tiny uppercase label underneath.
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-start justify-center gap-0 rounded-md border border-border/60 bg-background/40 px-2 py-2",
        className
      )}
    >
      <span
        className={cn(
          "min-h-[1.25rem] text-lg font-bold leading-none tracking-tight tabular-nums",
          isZero || pending ? "text-muted-foreground" : valueClassName
        )}
      >
        {display}
      </span>
      <span className="truncate text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  )
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
  /** Narrow sidebar — keep metrics in a 2×2 grid. */
  sidebar = false,
  /** Hide the primary intake action (rendered elsewhere in the scheduler sidebar). */
  hidePrimaryAction = false,
  rawCalendarJobs,
  todayKey,
  completedTodayLedger,
  /** Quiet KPI tiles while board data is still settling. */
  metricsPending = false,
}: {
  poolJobs: UnassignedPoolJob[]
  activePipelineJobs: ActivePipelineJob[]
  dayEvents: SchedulerEvent[]
  className?: string
  embedded?: boolean
  compact?: boolean
  sidebar?: boolean
  hidePrimaryAction?: boolean
  rawCalendarJobs?: readonly SchedulerEvent[]
  todayKey?: string
  completedTodayLedger?: ReadonlyMap<string, string>
  metricsPending?: boolean
}) {
  const isMobile = useIsMobile()
  const showPillRow = compact
  const useShortLabels = showPillRow || isMobile || sidebar
  const inboundCallPanel = useInboundCallPanelOptional()
  const metrics = useMemo(
    () =>
      computeDispatchOperationsMetrics({
        poolJobs,
        activePipelineJobs,
        dayEvents,
        rawCalendarJobs,
        todayKey,
        completedTodayLedger,
      }),
    [poolJobs, activePipelineJobs, dayEvents, rawCalendarJobs, todayKey, completedTodayLedger]
  )

  return (
    <div className={cn("min-w-0", className)} aria-label="Live dispatch operations summary">
      <div
        className={cn(
          showPillRow
            ? "flex flex-nowrap gap-2 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-4",
          sidebar && !showPillRow && "sm:grid-cols-2 gap-1 px-3 py-2",
          !showPillRow && !embedded && "border-b border-border bg-card/90 backdrop-blur"
        )}
      >
        <MetricCell
          compact={showPillRow}
          pending={metricsPending}
          label={useShortLabels ? "Active" : "Active Dispatches"}
          value={metrics.activeDispatches}
          valueClassName="text-sky-300"
        />
        <MetricCell
          compact={showPillRow}
          pending={metricsPending}
          label={useShortLabels ? "Pool" : "Unassigned Pool"}
          value={metrics.unassignedPool}
          valueClassName="text-warning"
        />
        <MetricCell
          compact={showPillRow}
          pending={metricsPending}
          label={useShortLabels ? "On-site" : "On-Site"}
          value={metrics.onSite}
          valueClassName="text-success"
        />
        <MetricCell
          compact={showPillRow}
          pending={metricsPending}
          label={useShortLabels ? "Done" : "Completed Today"}
          value={metrics.completedToday}
          valueClassName="text-foreground"
        />
        {showPillRow && inboundCallPanel && !hidePrimaryAction ? (
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 snap-start gap-2 rounded-full bg-primary px-3 text-2xs font-semibold text-primary-foreground"
            onClick={() => inboundCallPanel.openManualCallPanel()}
          >
            <Plus className="h-3 w-3" aria-hidden />
            Manual
          </Button>
        ) : null}
      </div>
      {!showPillRow && inboundCallPanel && !hidePrimaryAction ? (
        <div
          className={cn(
            "px-3 pb-2",
            sidebar ? "pt-0" : "px-3 md:px-8",
            !embedded && "border-b border-border bg-card/90 backdrop-blur md:pb-3"
          )}
        >
          <Button
            type="button"
            size="sm"
            className="h-8 w-full gap-2 bg-primary font-semibold text-primary-foreground shadow-md hover:bg-primary/90 md:w-auto"
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
