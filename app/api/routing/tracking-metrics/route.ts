// GET /api/routing/tracking-metrics — spam blocks this week + textback rescued revenue.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getSpamBlockedCountThisWeek, getTextbackRescueRevenueCents } from "@/lib/db"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Require a logged-in operator session.
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Optional org scope + browser timezone for "this week" window.
  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const timezone = sanitizeIanaTimezone(req.nextUrl.searchParams.get("timezone"))

  try {
    // Load both tracking metrics in parallel for the Caller ID + Textback cards.
    const [spam_blocked_this_week, textback_rescue_revenue_cents] = await Promise.all([
      getSpamBlockedCountThisWeek(userId, organizationId, timezone),
      getTextbackRescueRevenueCents(userId, organizationId),
    ])
    return NextResponse.json({
      data: {
        spam_blocked_this_week,
        textback_rescue_revenue_cents,
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/tracking-metrics] failed:", e)
    return NextResponse.json({ error: "Could not load tracking metrics" }, { status: 500 })
  }
}
