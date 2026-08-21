import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"
import { cookies } from "next/headers"
import { getCachedSessionUser } from "@/lib/server/cached-session"
import { getActivitySsrCalls } from "@/lib/server/activity-ssr-seed"
import { TIMEZONE_COOKIE, parseTimezoneCookie } from "@/lib/browser-timezone-cookie"

export const dynamic = "force-dynamic"

/** Hard refresh SSR’s real call rows — no empty well, no short wrong cookie list. */
export default async function ActivityRoute() {
  const user = await getCachedSessionUser()
  const cookieStore = await cookies()
  // Same zone the phone saved — times in first HTML match the live list.
  const timeZone = parseTimezoneCookie(cookieStore.get(TIMEZONE_COOKIE)?.value)
  let initialCalls: Awaited<ReturnType<typeof getActivitySsrCalls>> = []
  if (user?.id) {
    try {
      initialCalls = await getActivitySsrCalls(user.id, timeZone)
    } catch (e) {
      console.error("[dashboard/activity] SSR call seed", e)
    }
  }
  return <ActivityWorkspaceView initialCalls={initialCalls} />
}
