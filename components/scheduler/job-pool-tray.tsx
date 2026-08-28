"use client"

// Horizontal "Unassigned Job Pool" tray above the scheduler grid.

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Inbox, LifeBuoy, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { JobPoolCard } from "@/components/scheduler/job-pool-card"
import { useSchedulerMobileTimeline } from "@/hooks/use-scheduler-mobile-timeline"
import { useLiveClock } from "@/lib/hooks/use-live-clock"
import { sortPoolJobsByBookingPriority } from "@/lib/job-pool-display"
import { isPriceDeniedRescueJob } from "@/lib/rescue-queue"
import { SCHEDULER_GLASS_CARD } from "@/lib/scheduler-ui-tokens"
import { MOTION_SPRING_LAYOUT, useMotionPrefs } from "@/lib/motion"
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
  const { prefersReducedMotion } = useMotionPrefs()
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
  // Header icon/subtitle must not claim "has jobs" while loading, then correct to
  // "empty" once settled — treat unknown (loading) the same as empty until settled.
  const poolLooksEmpty = loading || jobs.length === 0

  return (
    <section
      className={cn(
        "w-full",
        embedded ? "px-0 py-0" : SCHEDULER_GLASS_CARD,
        !embedded && (sidebar ? "px-3 py-3" : "px-4 py-3")
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              poolLooksEmpty
                ? "bg-zinc-800/80 text-muted-foreground"
                : "bg-amber-500/15 text-amber-200",
              sidebar || embedded ? "h-7 w-7" : "h-8 w-8"
            )}
          >
            <Inbox className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Job pool</h2>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {poolLooksEmpty
                ? "Unassigned bookings land here"
                : mobileTimeline || sidebar || embedded
                  ? "Tap Assign on a card to pick a tech"
                  : "Drag onto a technician column — or open the card to assign"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-5 min-w-[4.5rem] shrink-0 items-center justify-center rounded-md px-2 text-[10px] font-semibold uppercase tracking-wide",
            loading
              ? "text-muted-foreground"
              : poolIsEmpty
                ? "border border-zinc-800 bg-zinc-950/50 text-muted-foreground"
                : "bg-amber-500/15 text-amber-200"
          )}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : poolIsEmpty ? (
            "Clear"
          ) : (
            `${jobs.length} waiting`
          )}
        </span>
      </div>

      {/* Always mount filter tabs — hide when empty so height never pops in with first job. */}
      <div
        className={cn(
          "mb-2 flex gap-1 rounded-lg border border-slate-800/80 bg-slate-900/40 p-0.5",
          poolIsEmpty && viewFilter === "all" && "invisible pointer-events-none"
        )}
        aria-hidden={poolIsEmpty && viewFilter === "all"}
      >
        <button
          type="button"
          onClick={() => setViewFilter("all")}
          className={cn(
            "flex-1 rounded-md px-2 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors",
            viewFilter === "all"
              ? "bg-slate-800 text-slate-100"
              : "text-muted-foreground hover:text-slate-300"
          )}
        >
          All pool ({jobs.length})
        </button>
        <button
          type="button"
          onClick={() => setViewFilter("rescue")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors",
            viewFilter === "rescue"
              ? "bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/40"
              : "text-rose-300/80 hover:text-rose-100"
          )}
        >
          <LifeBuoy className="h-3 w-3" aria-hidden />
          Rescue ({rescueJobs.length})
        </button>
      </div>

      {/* Always reserve Assign-next CTA height. */}
      <div className="mb-2 min-h-[2.75rem]">
        {!poolIsEmpty && visibleJobs[0] && (onMobileAssignJob || onSelectJob) ? (
          <button
            type="button"
            onClick={() => {
              const next = visibleJobs[0]
              if (!next) return
              if (onMobileAssignJob) onMobileAssignJob(next)
              else onSelectJob?.(next)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-3 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25"
          >
            Assign next waiting job
            <span className="truncate text-xs font-normal text-emerald-200/80">
              {(visibleJobs[0].customer_name || visibleJobs[0].job_type || "Job").trim()}
            </span>
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          sidebar || embedded
            ? "flex min-h-[7.5rem] w-full max-h-[min(280px,32vh)] flex-col gap-2 overflow-y-auto overscroll-y-contain"
            : mobileTimeline
              ? "flex min-h-[7.5rem] max-h-[min(420px,50vh)] flex-col gap-2 overflow-y-auto overscroll-y-contain"
              : "flex min-h-[5rem] gap-2 overflow-x-auto pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {!loading && visibleJobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800/90 bg-zinc-950/30 px-3 py-3 text-center text-xs leading-relaxed text-muted-foreground">
            {viewFilter === "rescue"
              ? "No Price Denied jobs — rejected quotes land here for outreach."
              : "Pool is empty. New intakes without a tech show up here."}
          </p>
        ) : null}
        {prefersReducedMotion ? (
          visibleJobs.map((job) => (
            <JobPoolCard
              key={job.id}
              job={job}
              highlighted={highlightId === job.id}
              onSelect={onSelectJob}
              onMobileAssign={onMobileAssignJob}
              variant={sidebar || embedded ? "sidebar" : "default"}
            />
          ))
        ) : (
          // sortedJobs re-derives every tick from the live clock, so priority order genuinely
          // shifts over time — `layout` gives that reorder a FLIP animation instead of a jump.
          <AnimatePresence initial={false}>
            {visibleJobs.map((job) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={MOTION_SPRING_LAYOUT}
              >
                <JobPoolCard
                  job={job}
                  highlighted={highlightId === job.id}
                  onSelect={onSelectJob}
                  onMobileAssign={onMobileAssignJob}
                  variant={sidebar || embedded ? "sidebar" : "default"}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  )
}
