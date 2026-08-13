import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Activities so a hard refresh SSR’s the real table chrome, not a chunk fallback. */
export default function ActivityRoute() {
  // Presence host keeps this tree mounted after the first visit; isActive is injected there.
  return <ActivityWorkspaceView />
}
