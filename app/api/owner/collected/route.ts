// GET /api/owner/collected — today / week / month / all-time settled payment totals.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerCollectedSummary } from "@/lib/owner-collected"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const data = await getOwnerCollectedSummary(userId)
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[GET /api/owner/collected]", e)
    return NextResponse.json({ error: "Could not load collected total" }, { status: 500 })
  }
}
