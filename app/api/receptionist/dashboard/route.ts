// GET /api/receptionist/dashboard — payout metrics + ledger for the signed-in receptionist.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { buildReceptionistPortalDashboard } from "@/lib/receptionist-portal"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const ctx = await getReceptionistPortalContext(userId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    // Operator's timezone so "today" ends at their midnight, not UTC's — a 9pm Eastern
    // call belongs to the shift being worked, not to tomorrow.
    const timezone = req.nextUrl.searchParams.get("timezone")
    const data = await buildReceptionistPortalDashboard(ctx, { timezone })
    return NextResponse.json({ data })
  } catch (error) {
    console.error("[lyncr] receptionist dashboard:", error)
    return NextResponse.json({ error: "Failed to load receptionist dashboard" }, { status: 500 })
  }
}
