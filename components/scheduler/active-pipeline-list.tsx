"use client"

import { Suspense } from "react"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import { useActivePipelineSuspenseQuery } from "@/lib/hooks/use-job-pool-query"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { ActivePipelinePanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { ActivePipelineJob } from "@/lib/types"

type ActivePipelineListProps = {
  dayKey: string
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
}

function ActivePipelineListInner({ dayKey, highlightId, onFocusJob }: ActivePipelineListProps) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const jobs = useActivePipelineSuspenseQuery(activeOrganizationId, dayKey, true)
  return <ActivePipelinePanel jobs={jobs} highlightId={highlightId} onFocusJob={onFocusJob} />
}

export function ActivePipelineList(props: ActivePipelineListProps) {
  return (
    <Suspense fallback={<ActivePipelinePanelSkeleton />}>
      <ActivePipelineListInner {...props} />
    </Suspense>
  )
}
