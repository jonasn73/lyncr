import { SchedulerWorkspaceView } from "@/components/workspace-views/scheduler-workspace-view"
import { activePipelinePromise, jobPoolPromise } from "@/lib/server/streamed-dashboard-data"

export default function SchedulerRoute() {
  return (
    <SchedulerWorkspaceView
      jobPoolPromise={jobPoolPromise()}
      activePipelinePromise={activePipelinePromise()}
    />
  )
}
