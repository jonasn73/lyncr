// GET /api/owner/collected — today / yesterday / week / month / all-time settled payment totals.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerCollectedSummary } from "@/lib/owner-collected"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    // Prefer the phone’s timezone so “Yesterday $195” matches Louisville, not UTC midnight.
    const timezone = sanitizeIanaTimezone(req.nextUrl.searchParams.get("timezone"))
    const data = await getOwnerCollectedSummary(userId, timezone)
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[GET /api/owner/collected]", e)
    return NextResponse.json({ error: "Could not load collected total" }, { status: 500 })
  }
}
