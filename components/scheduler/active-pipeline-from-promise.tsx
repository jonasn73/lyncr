"use client"

import { use } from "react"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import type { ActivePipelineJob } from "@/lib/types"

type ActivePipelineFromPromiseProps = {
  jobsPromise: Promise<ActivePipelineJob[]>
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
}

export function ActivePipelineFromPromise({
  jobsPromise,
  highlightId,
  onFocusJob,
}: ActivePipelineFromPromiseProps) {
  const initialJobs = use(jobsPromise)
  return (
    <ActivePipelinePanel jobs={initialJobs} highlightId={highlightId} onFocusJob={onFocusJob} />
  )
}
