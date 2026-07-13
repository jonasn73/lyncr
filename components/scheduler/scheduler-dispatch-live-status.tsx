"use client"

// Live clock + upcoming jobs row for the owner dispatch scheduler.

import { memo, useMemo } from "react"
import { Check, Clock3, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { DispatchOperationsMetricStrip } from "@/components/scheduler/dispatch-operations-metric-strip"
import { formatSchedulerLiveClock, useLiveClock } from "@/lib/hooks/use-live-clock"
import {
  formatUpcomingJobTime,
  listUpcomingSchedulerJobs,
  upcomingJobNeedsDispatch,
  type UpcomingSchedulerJob,
} from "@/lib/scheduler-upcoming-jobs"
import {
  formatSchedulerJobCountdown,
  resolveSchedulerJobUrgency,
  SCHEDULER_URGENCY_CHIP_CLASS,
  SCHEDULER_URGENCY_LABEL,
  SCHEDULER_URGENCY_TIME_CLASS,
} from "@/lib/scheduler-job-urgency"
import { SCHEDULER_LIVE_STATUS_SHELL, SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"
import { SCHEDULER_STATUS_LABEL } from "@/lib/scheduler-job-status"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

function UpcomingJobChip({
  job,
  now,
  stackLayout,
  onSelectJob,
  onMarkComplete,
  completingJobId,
}: {
  job: UpcomingSchedulerJob
  now: Date
  /** Mobile vertical list — full-width rows, no horizontal clip. */
  stackLayout?: boolean
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
  // Unscheduled / unassigned jobs cannot be closed out — show Needs Dispatch instead.
  const needsDispatch = upcomingJobNeedsDispatch(job)

  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-2.5 py-1.5 text-left",
        stackLayout ? "w-full min-w-0" : "min-w-[12rem] shrink-0 snap-start",
        SCHEDULER_URGENCY_CHIP_CLASS[urgency]
      )}
    >
      <button type="button" onClick={() => onSelectJob?.(job.id)} className="min-w-0 text-left">
        <span className={cn(SCHEDULER_METADATA_LABEL, "tabular-nums", SCHEDULER_URGENCY_TIME_CLASS[urgency])}>
          {timeLabel}
          {countdown ? ` · ${countdown}` : ""}
        </span>
        {/* Stack layout drops truncate so names like "Allen" are not sliced off. */}
        <span
          className={cn(
            "mt-0.5 block text-xs font-medium text-slate-100",
            stackLayout ? "break-words" : "truncate"
          )}
        >
          {name}
        </span>
        <span className={cn("block", stackLayout ? "break-words" : "truncate", SCHEDULER_METADATA_LABEL)}>
          {[job.job_type, status, job.assigned_tech_name].filter(Boolean).join(" · ")}
        </span>
        {urgency !== "later" && urgency !== "unscheduled" ? (
          <span className={cn("mt-0.5 block", SCHEDULER_METADATA_LABEL)}>
            {SCHEDULER_URGENCY_LABEL[urgency]}
          </span>
        ) : null}
      </button>
      {needsDispatch ? (
        // Low-profile tag — replaces Mark Done when the job still needs dispatch.
        <span className="inline-flex w-fit items-center rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">
          Needs Dispatch
        </span>
      ) : onMarkComplete ? (
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

function UpcomingJobsList({
  upcoming,
  now,
  stackLayout,
  onSelectJob,
  onMarkComplete,
  completingJobId,
}: {
  upcoming: UpcomingSchedulerJob[]
  now: Date
  stackLayout: boolean
  onSelectJob?: (jobId: string) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
}) {
  if (upcoming.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-800/80 bg-zinc-950/20 px-2.5 py-2 text-xs text-zinc-500">
        Nothing scheduled for this day yet.
      </p>
    )
  }

  return (
    <div
      className={cn(
        // Mobile: vertical stack so chips never clip sideways.
        stackLayout
          ? "flex flex-col gap-2"
          : "flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
    >
      {upcoming.map((job) => (
        <UpcomingJobChip
          key={job.id}
          job={job}
          now={now}
          stackLayout={stackLayout}
          onSelectJob={onSelectJob}
          onMarkComplete={onMarkComplete}
          completingJobId={completingJobId}
        />
      ))}
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
  rawCalendarJobs,
  todayKey,
  completedTodayLedger,
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
  rawCalendarJobs?: readonly SchedulerEvent[]
  todayKey?: string
  completedTodayLedger?: ReadonlyMap<string, string>
  upcomingOnly?: boolean
}) {
  const now = useLiveClock()
  const isMobile = useIsMobile()
  const clockLabel = formatSchedulerLiveClock(now)
  // Force vertical stack on phone viewports (and upcoming-only sheet).
  const stackLayout = isMobile || upcomingOnly

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
        <UpcomingJobsList
          upcoming={upcoming}
          now={now}
          stackLayout={stackLayout}
          onSelectJob={onSelectJob}
          onMarkComplete={onMarkComplete}
          completingJobId={completingJobId}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        SCHEDULER_LIVE_STATUS_SHELL,
        compact && "border-0 bg-transparent backdrop-blur-none",
        embedded && !compact && "rounded-t-xl",
        className
      )}
      aria-label="Dispatch live status"
    >
      <div>
        <div
          className={cn(
            "flex gap-0",
            compact || sidebar ? "flex-col" : "flex-col md:flex-row md:items-stretch"
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-center gap-2",
              compact
                ? "px-0 py-0"
                : sidebar
                  ? "border-b border-zinc-800/80 px-3 py-2"
                  : "border-b border-zinc-800/80 px-3 py-2 md:border-b-0 md:border-r md:px-3.5 md:py-2.5"
            )}
          >
            <Clock3
              className={cn("shrink-0 text-primary", compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5")}
              aria-hidden
            />
            <div className="flex min-w-0 flex-col leading-tight">
              {!compact ? <span className={SCHEDULER_METADATA_LABEL}>Now</span> : null}
              {/* Absolute top live date/time token — keep this; remove nested date headers elsewhere. */}
              <time
                dateTime={now.toISOString()}
                className={cn(
                  "font-semibold tabular-nums text-zinc-100",
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
              rawCalendarJobs={rawCalendarJobs}
              todayKey={todayKey}
              completedTodayLedger={completedTodayLedger}
              poolJobs={poolJobs}
              activePipelineJobs={activePipelineJobs}
              dayEvents={dayEvents}
            />
          </div>
        </div>

        {/* Show upcoming in the left rail too — empty days stay a single quiet line. */}
        {!compact ? (
          <div
            className={cn(
              "border-t border-zinc-800/80",
              sidebar ? "px-3 py-2" : "px-3 py-2 md:px-3.5"
            )}
          >
            <p className={cn(SCHEDULER_METADATA_LABEL, "mb-1.5")}>Coming up next</p>
            <UpcomingJobsList
              upcoming={upcoming}
              now={now}
              stackLayout={stackLayout || sidebar}
              onSelectJob={onSelectJob}
              onMarkComplete={onMarkComplete}
              completingJobId={completingJobId}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
})
