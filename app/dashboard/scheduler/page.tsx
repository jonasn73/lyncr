import { SchedulerWorkspaceView } from "@/components/workspace-views/scheduler-workspace-view"

/** Scheduler shell returns instantly; job pool + pipeline stream via layout {@link DashboardStreamProvider}. */
export default function SchedulerRoute() {
  return <SchedulerWorkspaceView />
}
