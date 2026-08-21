import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"
import { getCachedSessionUser } from "@/lib/server/cached-session"
import { getActivitySsrCalls } from "@/lib/server/activity-ssr-seed"

export const dynamic = "force-dynamic"

/** Hard refresh SSR’s real call rows — no empty well, no short wrong cookie list. */
export default async function ActivityRoute() {
  const user = await getCachedSessionUser()
  let initialCalls: Awaited<ReturnType<typeof getActivitySsrCalls>> = []
  if (user?.id) {
    try {
      initialCalls = await getActivitySsrCalls(user.id)
    } catch (e) {
      console.error("[dashboard/activity] SSR call seed", e)
    }
  }
  return <ActivityWorkspaceView initialCalls={initialCalls} />
}
