"use client"

import { Suspense } from "react"
import { JobPoolTray } from "@/components/scheduler/job-pool-tray"
import { useJobPoolSuspenseQuery } from "@/lib/hooks/use-job-pool-query"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { JobPoolPanelSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { UnassignedPoolJob } from "@/lib/types"

type JobPoolListProps = {
  highlightId?: string | null
  onSelectJob?: (job: UnassignedPoolJob) => void
}

function JobPoolListInner({ highlightId, onSelectJob }: JobPoolListProps) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const jobs = useJobPoolSuspenseQuery(activeOrganizationId)
  return <JobPoolTray jobs={jobs} highlightId={highlightId} onSelectJob={onSelectJob} />
}

export function JobPoolList(props: JobPoolListProps) {
  return (
    <Suspense fallback={<JobPoolPanelSkeleton />}>
      <JobPoolListInner {...props} />
    </Suspense>
  )
}
