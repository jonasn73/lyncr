"use client"

// Live KPI banner for the dispatch scheduler — number-first tiles, quiet zeros.

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
  /** Accent color when the count is non-zero. */
  valueClassName?: string
  className?: string
  compact?: boolean
}

function MetricCell({
  label,
  value,
  valueClassName,
  className,
  compact = false,
}: MetricCellProps) {
  // Zero counts stay muted so non-zero KPIs pop as the signal.
  const isZero = value === 0

  // Compact map toolbar — horizontal pill chip.
  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-1",
          className
        )}
      >
        <span className="text-[10px] font-medium text-zinc-500">{label}</span>
        <span
          className={cn(
            "text-xs font-bold tabular-nums",
            isZero ? "text-zinc-600" : valueClassName
          )}
        >
          {value}
        </span>
      </div>
    )
  }

  // Number-first tile — big tabular digit, tiny uppercase label underneath.
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-start justify-center gap-1 rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-3 py-2.5",
        className
      )}
    >
      <span
        className={cn(
          "text-2xl font-bold leading-none tracking-tight tabular-nums",
          isZero ? "text-zinc-600" : valueClassName
        )}
      >
        {value}
      </span>
      <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
            ? "flex flex-nowrap gap-1.5 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "grid grid-cols-2 gap-2 px-2.5 py-2.5 xl:grid-cols-4 xl:gap-2.5 xl:px-4 xl:py-3",
          sidebar && !showPillRow && "xl:grid-cols-2 xl:px-2.5 xl:py-2",
          !showPillRow && !embedded && "border-b border-zinc-800 bg-zinc-900/90 backdrop-blur"
        )}
      >
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Active" : "Active Dispatches"}
          value={metrics.activeDispatches}
          valueClassName="text-sky-300"
        />
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Pool" : "Unassigned Pool"}
          value={metrics.unassignedPool}
          valueClassName="text-amber-300"
        />
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "On-site" : "On-Site"}
          value={metrics.onSite}
          valueClassName="text-emerald-300"
        />
        <MetricCell
          compact={showPillRow}
          label={useShortLabels ? "Done" : "Completed Today"}
          value={metrics.completedToday}
          valueClassName="text-zinc-200"
        />
        {showPillRow && inboundCallPanel && !hidePrimaryAction ? (
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
      {!showPillRow && inboundCallPanel && !hidePrimaryAction ? (
        <div
          className={cn(
            "px-2.5 pb-2",
            sidebar ? "pt-0" : "px-3 md:px-8",
            !embedded && "border-b border-zinc-800 bg-zinc-900/90 backdrop-blur md:pb-2.5"
          )}
        >
          <Button
            type="button"
            size="sm"
            className="h-8 w-full gap-1.5 bg-primary font-semibold text-primary-foreground shadow-md hover:bg-primary/90 md:w-auto"
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
