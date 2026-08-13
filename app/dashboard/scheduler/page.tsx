import { SchedulerWorkspaceView } from "@/components/workspace-views/scheduler-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Scheduler so a hard refresh SSR’s calendar chrome, not SchedulerPaneFallback. */
export default function SchedulerRoute() {
  // Session bootstrap cache is re-applied in useLayoutEffect before the first client paint.
  return <SchedulerWorkspaceView />
}
