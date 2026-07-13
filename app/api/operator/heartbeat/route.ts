// POST /api/operator/heartbeat — dashboard tab is open (session activity for SMS gate).

import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { touchOperatorDashboardHeartbeat } from "@/lib/operator-dashboard-heartbeat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  // Require a signed-in dashboard user.
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Heartbeat under the business account id (receptionists map to OWNER).
  const accountId = await resolveWorkspaceAccountId(user.id)
  // Stamp last_seen_at in Neon.
  await touchOperatorDashboardHeartbeat(accountId)
  return NextResponse.json({ data: { ok: true } })
}
