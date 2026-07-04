"use client"

// Live clock + upcoming jobs row for the owner dispatch scheduler.

import { memo, useMemo } from "react"
import { Check, Clock3, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DispatchOperationsMetricStrip } from "@/components/scheduler/dispatch-operations-metric-strip"
import { formatSchedulerLiveClock, useLiveClock } from "@/lib/hooks/use-live-clock"
import {
  formatUpcomingJobTime,
  listUpcomingSchedulerJobs,
  type UpcomingSchedulerJob,
} from "@/lib/scheduler-upcoming-jobs"
import {
  formatSchedulerJobCountdown,
  resolveSchedulerJobUrgency,
  SCHEDULER_URGENCY_CHIP_CLASS,
  SCHEDULER_URGENCY_LABEL,
  SCHEDULER_URGENCY_TIME_CLASS,
} from "@/lib/scheduler-job-urgency"
import { SCHEDULER_STATUS_LABEL } from "@/lib/scheduler-job-status"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

function UpcomingJobChip({
  job,
  now,
  onSelectJob,
  onMarkComplete,
  completingJobId,
}: {
  job: UpcomingSchedulerJob
  now: Date
  onSelectJob?: (jobId: string) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
}) {
  const name = job.customer_name?.trim() || "Unknown customer"
  const timeLabel = job.isActiveNow ? "Now" : formatUpcomingJobTime(job.scheduled_at)
  const status = SCHEDULER_STATUS_LABEL[job.phase]
  const urgency = resolveSchedulerJobUrgency({
    now,
    scheduled_at: job.scheduled_at,
    phase: job.phase,
  })
  const countdown = job.isActiveNow ? null : formatSchedulerJobCountdown(now, job.scheduled_at)
  const isCompleting = completingJobId === job.id

  return (
    <div
      className={cn(
        "flex min-w-[12rem] shrink-0 snap-start flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
        SCHEDULER_URGENCY_CHIP_CLASS[urgency]
      )}
    >
      <button type="button" onClick={() => onSelectJob?.(job.id)} className="text-left">
        <span className={cn("text-[10px] font-semibold tabular-nums", SCHEDULER_URGENCY_TIME_CLASS[urgency])}>
          {timeLabel}
          {countdown ? ` · ${countdown}` : ""}
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-zinc-100">{name}</span>
        <span className="block truncate text-[10px] text-zinc-500">
          {[job.job_type, status, job.assigned_tech_name].filter(Boolean).join(" · ")}
        </span>
        {urgency !== "later" && urgency !== "unscheduled" ? (
          <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
            {SCHEDULER_URGENCY_LABEL[urgency]}
          </span>
        ) : null}
      </button>
      {onMarkComplete ? (
        <button
          type="button"
          disabled={isCompleting}
          onClick={() => onMarkComplete(job.id)}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200 hover:bg-emerald-500/20"
        >
          {isCompleting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
          Mark done
        </button>
      ) : null}
    </div>
  )
}

export const SchedulerDispatchLiveStatus = memo(function SchedulerDispatchLiveStatus({
  selectedDay,
  poolJobs,
  activePipelineJobs,
  dayEvents,
  onSelectJob,
  onMarkComplete,
  completingJobId,
  className,
  embedded = false,
  /** Slim single-row toolbar for mobile map overlay. */
  compact = false,
  /** Dense left sidebar on desktop — hides upcoming row and tightens padding. */
  sidebar = false,
  /** Primary intake action is rendered above the sidebar stack in scheduler workspace. */
  hidePrimaryAction = false,
  /** Only the upcoming jobs row (mobile bottom sheet). */
  upcomingOnly = false,
}: {
  selectedDay: Date
  poolJobs: UnassignedPoolJob[]
  activePipelineJobs: ActivePipelineJob[]
  dayEvents: SchedulerEvent[]
  onSelectJob?: (jobId: string) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
  className?: string
  embedded?: boolean
  compact?: boolean
  sidebar?: boolean
  hidePrimaryAction?: boolean
  upcomingOnly?: boolean
}) {
  const now = useLiveClock()
  const clockLabel = formatSchedulerLiveClock(now)

  const upcoming = useMemo(
    () =>
      listUpcomingSchedulerJobs({
        now,
        selectedDay,
        activePipelineJobs,
        dayEvents,
        poolJobs,
        limit: 5,
      }),
    [now, selectedDay, activePipelineJobs, dayEvents, poolJobs]
  )

  if (upcomingOnly) {
    return (
      <div className={cn(className)} aria-label="Upcoming jobs">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Coming up next</p>
        {upcoming.length === 0 ? (
          <p className="text-xs text-zinc-600">No upcoming jobs for this day.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {upcoming.map((job) => (
              <UpcomingJobChip
                key={job.id}
                job={job}
                now={now}
                onSelectJob={onSelectJob}
                onMarkComplete={onMarkComplete}
                completingJobId={completingJobId}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/90 backdrop-blur",
        compact && "border-0 bg-transparent",
        embedded && !compact && "rounded-t-xl",
        className
      )}
      aria-label="Dispatch live status"
    >
      <div>
        <div className={cn("flex gap-2", compact || sidebar ? "flex-col gap-0" : "flex-col gap-0 md:flex-row md:items-stretch")}>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5",
              compact ? "px-0 py-0" : sidebar
                ? "border-b border-zinc-800/80 px-2.5 py-1.5"
                : "border-b border-zinc-800/80 px-3 py-2 md:border-b-0 md:border-r md:px-4 md:py-3"
            )}
          >
            <Clock3 className={cn("shrink-0 text-primary", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
            <div className="flex min-w-0 flex-col">
              {!compact ? (
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Now</span>
              ) : null}
              <time
                dateTime={now.toISOString()}
                className={cn(
                  "font-bold tabular-nums text-zinc-100",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {clockLabel}
              </time>
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <DispatchOperationsMetricStrip
              embedded
              compact={compact}
              sidebar={sidebar}
              hidePrimaryAction={hidePrimaryAction}
              poolJobs={poolJobs}
              activePipelineJobs={activePipelineJobs}
              dayEvents={dayEvents}
            />
          </div>
        </div>

        {!compact && !sidebar ? (
          <div className="border-t border-zinc-800/80 px-3 py-2 md:px-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Coming up next
            </p>
            {upcoming.length === 0 ? (
              <p className="text-xs text-zinc-600">No upcoming jobs for this day.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {upcoming.map((job) => (
                  <UpcomingJobChip
                    key={job.id}
                    job={job}
                    now={now}
                    onSelectJob={onSelectJob}
                    onMarkComplete={onMarkComplete}
                    completingJobId={completingJobId}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
})
