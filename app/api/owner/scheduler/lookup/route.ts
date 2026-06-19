// GET /api/owner/scheduler/lookup?phone= — search pool + calendar by phone

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { searchOwnerJobsByPhone } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const phone = req.nextUrl.searchParams.get("phone")?.trim() ?? ""
  if (phone.replace(/\D/g, "").length < 7) {
    return NextResponse.json({ data: { pool: [], scheduled: [] } })
  }

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const orgId = organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  try {
    const result = await searchOwnerJobsByPhone({
      ownerUserId: userId,
      phoneQuery: phone,
      organizationId: orgId,
    })
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[GET /api/owner/scheduler/lookup]", e)
    return NextResponse.json({ data: { pool: [], scheduled: [] }, degraded: true })
  }
}
