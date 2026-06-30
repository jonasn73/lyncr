"use client"

import { Suspense } from "react"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { ActivePipelineFromPromise } from "@/components/scheduler/active-pipeline-from-promise"
import { ActivePipelineList } from "@/components/scheduler/active-pipeline-list"
import { ActivePipelinePanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { ActivePipelineJob } from "@/lib/types"

type ActivePipelinePanelStreamProps = {
  dayKey: string
  useStreamedInitialDay: boolean
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
  onEditJob?: (job: ActivePipelineJob) => void
  layout?: "default" | "mobileSheet"
}

/** Map left rail — streams today's pipeline on first paint; other days use client SWR. */
export function ActivePipelinePanelStream({
  dayKey,
  useStreamedInitialDay,
  highlightId,
  onFocusJob,
  onEditJob,
  layout = "default",
}: ActivePipelinePanelStreamProps) {
  const { activePipelinePromise } = useDashboardStream()

  if (useStreamedInitialDay && activePipelinePromise) {
    return (
      <Suspense fallback={<ActivePipelinePanelSkeleton />}>
        <ActivePipelineFromPromise
          jobsPromise={activePipelinePromise}
          highlightId={highlightId}
          onFocusJob={onFocusJob}
          onEditJob={onEditJob}
          layout={layout}
        />
      </Suspense>
    )
  }

  return (
    <ActivePipelineList
      dayKey={dayKey}
      highlightId={highlightId}
      onFocusJob={onFocusJob}
      onEditJob={onEditJob}
      layout={layout}
    />
  )
}
