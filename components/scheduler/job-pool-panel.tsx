"use client"

import { Suspense } from "react"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { JobPoolFromPromise } from "@/components/scheduler/job-pool-from-promise"
import { JobPoolList } from "@/components/scheduler/job-pool-list"
import { JobPoolPanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { UnassignedPoolJob } from "@/lib/types"

type JobPoolPanelProps = {
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
}

/** Hopper tray — streams in behind Suspense while the scheduler shell paints first. */
export function JobPoolPanel({ highlightId, onSelectJob }: JobPoolPanelProps) {
  const { jobPoolPromise } = useDashboardStream()

  if (jobPoolPromise) {
    return (
      <Suspense fallback={<JobPoolPanelSkeleton />}>
        <JobPoolFromPromise
          jobsPromise={jobPoolPromise}
          highlightId={highlightId}
          onSelectJob={onSelectJob}
        />
      </Suspense>
    )
  }

  return <JobPoolList highlightId={highlightId} onSelectJob={onSelectJob} />
}
