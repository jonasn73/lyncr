"use client"

// Live KPI banner for the dispatch map — stays inside the main column (no viewport bleed).

import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"
import { computeDispatchOperationsMetrics } from "@/lib/dispatch-operations-metrics"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type MetricCellProps = {
  label: string
  value: number
  tone?: "default" | "teal" | "amber" | "sky" | "gold" | "muted"
}

function MetricCell({ label, value, tone = "default" }: MetricCellProps) {
  return (
    <div className="inline-flex min-w-0 items-baseline gap-2">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.12em]",
          tone === "teal" && "text-teal-400/90",
          tone === "amber" && "text-amber-400/90",
          tone === "sky" && "text-sky-400/90",
          tone === "gold" && "text-yellow-400/90",
          tone === "muted" && "text-zinc-500",
          tone === "default" && "text-zinc-400"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "teal" && "text-teal-300",
          tone === "amber" && "text-amber-300",
          tone === "sky" && "text-sky-300",
          tone === "gold" && "text-yellow-300",
          tone === "muted" && "text-zinc-500",
          tone === "default" && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

export const DispatchOperationsMetricStrip = memo(function DispatchOperationsMetricStrip({
  poolJobs,
  activePipelineJobs,
  dayEvents,
  className,
}: {
  poolJobs: UnassignedPoolJob[]
  activePipelineJobs: ActivePipelineJob[]
  dayEvents: SchedulerEvent[]
  className?: string
}) {
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
    <div
      className={cn(
        // Span dashboard gutters only — never bleed under the fixed command dock.
        "-mx-5 w-[calc(100%+2.5rem)] sm:-mx-8 sm:w-[calc(100%+4rem)]",
        className
      )}
      aria-label="Live dispatch operations summary"
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 overflow-x-auto border-b border-zinc-800 bg-zinc-900/90 px-5 py-2.5 text-xs backdrop-blur sm:px-8">
        <MetricCell label="Active Dispatches" value={metrics.activeDispatches} tone="teal" />
        <MetricCell label="Unassigned Pool" value={metrics.unassignedPool} tone="amber" />
        <MetricCell label="On-Site" value={metrics.onSite} tone="gold" />
        <MetricCell label="Completed Today" value={metrics.completedToday} tone="muted" />
      </div>
    </div>
  )
})
