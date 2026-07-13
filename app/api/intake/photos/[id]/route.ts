// GET /api/intake/photos/[id] — serve a stored job photo (session-auth for owner account).

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { getJobPhotoBinary } from "@/lib/job-photo-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  // Only signed-in dashboard users may load attachment bytes.
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Photo UUID from the gallery URL.
  const { id } = await ctx.params
  // Load base64 blob from Neon.
  const photo = await getJobPhotoBinary(id)
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  // Allow the workspace OWNER and any team member mapped to that account.
  const accountId = await resolveWorkspaceAccountId(user.id)
  if (photo.ownerUserId !== user.id && photo.ownerUserId !== accountId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Decode base64 into binary for <img> responses.
  const buffer = Buffer.from(photo.dataBase64, "base64")
  // Return image bytes with a short cache for gallery re-renders.
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "private, max-age=120",
    },
  })
}
