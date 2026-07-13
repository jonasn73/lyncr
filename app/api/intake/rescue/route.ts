// GET /api/intake/rescue?call_log_id=… — rescue package for the live intake sheet.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { getIntakeRescueForCall } from "@/lib/job-photo-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const callLogId = req.nextUrl.searchParams.get("call_log_id")?.trim() || ""
  if (!callLogId) {
    return NextResponse.json({ data: null })
  }
  const accountId = await resolveWorkspaceAccountId(user.id)
  const pkg = await getIntakeRescueForCall({
    ownerUserId: accountId,
    callLogId,
  })
  return NextResponse.json({ data: pkg })
}
