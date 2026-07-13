"use client"

import { Suspense } from "react"
import { JobPoolList } from "@/components/scheduler/job-pool-list"
import { JobPoolTray } from "@/components/scheduler/job-pool-tray"
import { JobPoolPanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { UnassignedPoolJob } from "@/lib/types"

type JobPoolPanelProps = {
  /** Live hopper jobs from SWR — parent must pass so deletes/edits reflect immediately. */
  jobs?: UnassignedPoolJob[]
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
  onMobileAssignJob?: (job: UnassignedPoolJob) => void
  variant?: "default" | "sidebar"
  /** Nest inside a parent glass card — skip the outer shell. */
  embedded?: boolean
}

/** Hopper tray — uses live SWR jobs from the parent when provided. */
export function JobPoolPanel({
  jobs,
  highlightId,
  onSelectJob,
  onMobileAssignJob,
  variant = "default",
  embedded = false,
}: JobPoolPanelProps) {
  if (jobs !== undefined) {
    return (
      <JobPoolTray
        jobs={jobs}
        highlightId={highlightId}
        onSelectJob={onSelectJob}
        onMobileAssignJob={onMobileAssignJob}
        variant={variant}
        embedded={embedded}
      />
    )
  }

  return (
    <Suspense fallback={<JobPoolPanelSkeleton />}>
      <JobPoolList highlightId={highlightId} onSelectJob={onSelectJob} />
    </Suspense>
  )
}
