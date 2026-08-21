"use client"

import { Suspense } from "react"
import { ActivePipelineList } from "@/components/scheduler/active-pipeline-list"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import { ActivePipelinePanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { ActivePipelineJob } from "@/lib/types"

type ActivePipelinePanelStreamProps = {
  /** Live pipeline jobs from SWR — parent must pass so deletes/edits reflect immediately. */
  jobs?: ActivePipelineJob[]
  dayKey: string
  useStreamedInitialDay: boolean
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
  onEditJob: (job: ActivePipelineJob) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
  layout?: "default" | "mobileSheet"
  /** Quiet reserve while first paint loads — no “Loading…” / “No active jobs” flash. */
  loading?: boolean
}

/** Map left rail — uses live SWR jobs from the parent when provided. */
export function ActivePipelinePanelStream({
  jobs,
  dayKey,
  highlightId,
  onFocusJob,
  onEditJob,
  onMarkComplete,
  completingJobId,
  layout = "default",
  loading = false,
}: ActivePipelinePanelStreamProps) {
  if (jobs !== undefined) {
    return (
      <ActivePipelinePanel
        jobs={jobs}
        loading={loading}
        highlightId={highlightId}
        onFocusJob={onFocusJob}
        onEditJob={onEditJob}
        onMarkComplete={onMarkComplete}
        completingJobId={completingJobId}
        layout={layout}
      />
    )
  }

  return (
    <Suspense fallback={<ActivePipelinePanelSkeleton />}>
      <ActivePipelineList
        dayKey={dayKey}
        highlightId={highlightId}
        onFocusJob={onFocusJob}
        onEditJob={onEditJob}
        onMarkComplete={onMarkComplete}
        completingJobId={completingJobId}
        layout={layout}
      />
    </Suspense>
  )
}
