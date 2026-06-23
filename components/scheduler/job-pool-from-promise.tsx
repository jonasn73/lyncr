"use client"

import { use } from "react"
import { JobPoolTray } from "@/components/scheduler/job-pool-tray"
import type { UnassignedPoolJob } from "@/lib/types"

type JobPoolFromPromiseProps = {
  jobsPromise: Promise<UnassignedPoolJob[]>
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
}

export function JobPoolFromPromise({ jobsPromise, highlightId, onSelectJob }: JobPoolFromPromiseProps) {
  const initialJobs = use(jobsPromise)
  return (
    <JobPoolTray
      jobs={initialJobs}
      highlightId={highlightId}
      onSelectJob={onSelectJob}
    />
  )
}
