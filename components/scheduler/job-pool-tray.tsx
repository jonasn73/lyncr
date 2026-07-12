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
}

export function JobPoolTray({
  jobs,
  loading,
  highlightId,
  onSelectJob,
  onMobileAssignJob,
  variant = "default",
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

  return (
    <section
      className={cn(
        "w-full",
        SCHEDULER_GLASS_CARD,
        sidebar ? "px-3 py-2" : "px-4 py-3"
      )}
    >
      <div className={cn("flex items-center justify-between gap-2", sidebar ? "mb-1.5" : "mb-2")}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center justify-center rounded-xl bg-amber-500/15 text-amber-200",
              sidebar ? "h-7 w-7" : "h-8 w-8"
            )}
          >
            <Inbox className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Active job pool</h2>
            {!sidebar ? (
              <p className="text-[11px] font-normal text-slate-400 leading-relaxed tracking-normal lowercase first-letter:uppercase">
                {mobileTimeline
                  ? "Select an unassigned job below to schedule or assign."
                  : "Drag onto a technician column to assign & schedule"}
              </p>
            ) : (
              <p className="text-[11px] font-normal text-slate-400 leading-relaxed tracking-normal lowercase first-letter:uppercase">
                Drag jobs onto a tech lane to dispatch
              </p>
            )}
          </div>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden />
        ) : (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-200">
            {jobs.length} waiting
          </span>
        )}
      </div>

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

      <div
        className={cn(
          sidebar
            ? "flex w-full max-h-[min(320px,38vh)] flex-col gap-3 overflow-y-auto overscroll-y-contain"
            : mobileTimeline
              ? "flex max-h-[min(420px,50vh)] flex-col gap-2 overflow-y-auto overscroll-y-contain"
              : "flex gap-2 overflow-x-auto pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {!loading && visibleJobs.length === 0 ? (
          <p className="py-2 text-xs text-slate-500">
            {viewFilter === "rescue"
              ? "No Price Denied jobs in the rescue queue — rejected quotes land here for outreach."
              : "No unassigned jobs — new bookings without a tech land here."}
          </p>
        ) : null}
        {visibleJobs.map((job) => (
          <JobPoolCard
            key={job.id}
            job={job}
            highlighted={highlightId === job.id}
            onSelect={onSelectJob}
            onMobileAssign={onMobileAssignJob}
            variant={sidebar ? "sidebar" : "default"}
          />
        ))}
      </div>
    </section>
  )
}
