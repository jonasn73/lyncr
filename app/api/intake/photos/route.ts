// GET /api/intake/photos?call_log_id=… — list job photos for the active intake ticket.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { listJobPhotosForCall } from "@/lib/job-photo-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Dashboard session required.
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Call log / temporary ticket id from the intake sheet.
  const callLogId = req.nextUrl.searchParams.get("call_log_id")?.trim() || ""
  if (!callLogId) {
    return NextResponse.json({ data: { photos: [] } })
  }

  // List under the business account (receptionists map to OWNER).
  const accountId = await resolveWorkspaceAccountId(user.id)
  const photos = await listJobPhotosForCall({
    ownerUserId: accountId,
    callLogId,
  })
  return NextResponse.json({ data: { photos } })
}
