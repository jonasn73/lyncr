"use client"

import { Suspense } from "react"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import { useActivePipelineSuspenseQuery } from "@/lib/hooks/use-job-pool-query"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { ActivePipelinePanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import { FadeInOnMount } from "@/components/ui/fade-in-on-mount"
import type { ActivePipelineJob } from "@/lib/types"

type ActivePipelineListProps = {
  dayKey: string
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
  onEditJob: (job: ActivePipelineJob) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
  layout?: "default" | "mobileSheet"
}

function ActivePipelineListInner({
  dayKey,
  highlightId,
  onFocusJob,
  onEditJob,
  onMarkComplete,
  completingJobId,
  layout,
}: ActivePipelineListProps) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const jobs = useActivePipelineSuspenseQuery(activeOrganizationId, dayKey, true)
  return (
    <FadeInOnMount>
      <ActivePipelinePanel
        jobs={jobs}
        highlightId={highlightId}
        onFocusJob={onFocusJob}
        onEditJob={onEditJob}
        onMarkComplete={onMarkComplete}
        completingJobId={completingJobId}
        layout={layout}
      />
    </FadeInOnMount>
  )
}

export function ActivePipelineList(props: ActivePipelineListProps) {
  return (
    <Suspense fallback={<ActivePipelinePanelSkeleton />}>
      <ActivePipelineListInner {...props} />
    </Suspense>
  )
}
