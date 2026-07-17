// GET /api/affiliates — active partner locksmiths for Partner Dispatch.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  listAffiliateLocksmiths,
  serializeAffiliateForApi,
} from "@/lib/affiliate-locksmiths"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null

  try {
    const rows = await listAffiliateLocksmiths(userId, organizationId)
    return NextResponse.json({
      data: { affiliates: rows.map(serializeAffiliateForApi) },
    })
  } catch (e) {
    console.error("[affiliates GET]", e)
    return NextResponse.json({ error: "Could not load affiliates" }, { status: 500 })
  }
}
