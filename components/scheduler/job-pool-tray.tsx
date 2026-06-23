"use client"

// Horizontal "Unassigned Job Pool" tray above the scheduler grid.

import { Inbox, Loader2 } from "lucide-react"
import { JobPoolCard } from "@/components/scheduler/job-pool-card"
import type { UnassignedPoolJob } from "@/lib/types"

type JobPoolTrayProps = {
  jobs: UnassignedPoolJob[]
  loading?: boolean
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
}

export function JobPoolTray({ jobs, loading, highlightId, onSelectJob }: JobPoolTrayProps) {
  return (
    <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-card to-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-200">
            <Inbox className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Active job pool</h2>
            <p className="text-[11px] text-zinc-500">Drag onto a technician column to assign & schedule</p>
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

      <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!loading && jobs.length === 0 ? (
          <p className="py-2 text-xs text-zinc-500">No unassigned jobs — new bookings without a tech land here.</p>
        ) : null}
        {jobs.map((job) => (
          <JobPoolCard
            key={job.id}
            job={job}
            highlighted={highlightId === job.id}
            onSelect={onSelectJob}
          />
        ))}
      </div>
    </section>
  )
}
