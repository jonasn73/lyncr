// GET /api/messaging — SMS thread feed for the active workspace dashboard.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getOrganizationForOwner,
  getUser,
  listSmsMessagesForOrganization,
} from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can view SMS threads" }, { status: 403 })
  }

  try {
    let organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() ?? ""
    if (!organizationId) {
      const def = await getDefaultOrganizationForOwner(userId)
      organizationId = def?.id ?? ""
    }
    const org = organizationId ? await getOrganizationForOwner(organizationId, userId) : null
    if (!org || org.id.startsWith("legacy-")) {
      return NextResponse.json({ data: { messages: [], organization_id: null } })
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "100")
    const messages = await listSmsMessagesForOrganization(userId, org.id, limitRaw)

    return NextResponse.json({
      data: {
        organization_id: org.id,
        messages,
      },
    })
  } catch (e) {
    console.error("[GET /api/messaging]", e)
    return NextResponse.json({ error: "Could not load messages" }, { status: 500 })
  }
}
