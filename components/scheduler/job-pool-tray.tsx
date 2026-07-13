"use client"

// Horizontal "Unassigned Job Pool" tray above the scheduler grid.

import { useMemo, useState } from "react"
import { Inbox, LifeBuoy, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { JobPoolCard } from "@/components/scheduler/job-pool-card"
import { useSchedulerMobileTimeline } from "@/hooks/use-scheduler-mobile-timeline"
import { useLiveClock } from "@/lib/hooks/use-live-clock"
import { sortPoolJobsByBookingPriority } from "@/lib/job-pool-display"
import { isPriceDeniedRescueJob } from "@/lib/rescue-queue"
import { SCHEDULER_GLASS_CARD } from "@/lib/scheduler-ui-tokens"
import type { UnassignedPoolJob } from "@/lib/types"

type PoolViewFilter = "all" | "rescue"

type JobPoolTrayProps = {
  jobs: UnassignedPoolJob[]
  loading?: boolean
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
  onMobileAssignJob?: (job: UnassignedPoolJob) => void
  /** Vertical compact list for the desktop left control column. */
  variant?: "default" | "sidebar"
  /** Nest inside a parent glass card — skip the outer shell. */
  embedded?: boolean
}

export function JobPoolTray({
  jobs,
  loading,
  highlightId,
  onSelectJob,
  onMobileAssignJob,
  variant = "default",
  embedded = false,
}: JobPoolTrayProps) {
  const [viewFilter, setViewFilter] = useState<PoolViewFilter>("all")
  const mobileTimeline = useSchedulerMobileTimeline()
  const sidebar = variant === "sidebar"
  const now = useLiveClock()
  const rescueJobs = useMemo(() => jobs.filter((job) => isPriceDeniedRescueJob(job)), [jobs])
  const sortedJobs = useMemo(
    () => sortPoolJobsByBookingPriority(jobs, now),
    [jobs, now]
  )
  const sortedRescueJobs = useMemo(
    () => sortPoolJobsByBookingPriority(rescueJobs, now),
    [rescueJobs, now]
  )
  const visibleJobs = viewFilter === "rescue" ? sortedRescueJobs : sortedJobs
  const poolIsEmpty = !loading && jobs.length === 0
  const showFilterTabs = jobs.length > 0 || rescueJobs.length > 0 || viewFilter === "rescue"

  return (
    <section
      className={cn(
        "w-full",
        embedded ? "px-0 py-0" : SCHEDULER_GLASS_CARD,
        !embedded && (sidebar ? "px-3 py-2.5" : "px-4 py-3")
      )}
    >
      <div className={cn("flex items-center justify-between gap-2", showFilterTabs ? "mb-2" : "mb-0")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              poolIsEmpty
                ? "bg-zinc-800/80 text-zinc-500"
                : "bg-amber-500/15 text-amber-200",
              sidebar || embedded ? "h-7 w-7" : "h-8 w-8"
            )}
          >
            <Inbox className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Job pool</h2>
            <p className="text-[11px] leading-snug text-slate-500">
              {poolIsEmpty
                ? "Unassigned bookings land here"
                : mobileTimeline || sidebar || embedded
                  ? "Assign to a tech lane to dispatch"
                  : "Drag onto a technician column to assign"}
            </p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" aria-hidden />
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              poolIsEmpty
                ? "border border-zinc-800 bg-zinc-950/50 text-zinc-500"
                : "bg-amber-500/15 text-amber-200"
            )}
          >
            {poolIsEmpty ? "Clear" : `${jobs.length} waiting`}
          </span>
        )}
      </div>

      {showFilterTabs ? (
        <div className="mb-2 flex gap-1 rounded-lg border border-slate-800/80 bg-slate-900/40 p-0.5">
          <button
            type="button"
            onClick={() => setViewFilter("all")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors",
              viewFilter === "all"
                ? "bg-slate-800 text-slate-100"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            All pool ({jobs.length})
          </button>
          <button
            type="button"
            onClick={() => setViewFilter("rescue")}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors",
              viewFilter === "rescue"
                ? "bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/40"
                : "text-rose-300/80 hover:text-rose-100"
            )}
          >
            <LifeBuoy className="h-3 w-3" aria-hidden />
            Rescue ({rescueJobs.length})
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          poolIsEmpty && viewFilter === "all"
            ? "pt-2"
            : sidebar || embedded
              ? "flex w-full max-h-[min(280px,32vh)] flex-col gap-2 overflow-y-auto overscroll-y-contain"
              : mobileTimeline
                ? "flex max-h-[min(420px,50vh)] flex-col gap-2 overflow-y-auto overscroll-y-contain"
                : "flex gap-2 overflow-x-auto pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {!loading && visibleJobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800/90 bg-zinc-950/30 px-3 py-3 text-center text-xs leading-relaxed text-zinc-500">
            {viewFilter === "rescue"
              ? "No Price Denied jobs — rejected quotes land here for outreach."
              : "Pool is empty. New intakes without a tech show up here."}
          </p>
        ) : null}
        {visibleJobs.map((job) => (
          <JobPoolCard
            key={job.id}
            job={job}
            highlighted={highlightId === job.id}
            onSelect={onSelectJob}
            onMobileAssign={onMobileAssignJob}
            variant={sidebar || embedded ? "sidebar" : "default"}
          />
        ))}
      </div>
    </section>
  )
}
