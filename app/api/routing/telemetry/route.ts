// GET /api/routing/telemetry — daily call HUD metrics for the routing strip.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getDailyCallTelemetryForOwner } from "@/lib/db"
import { formatAvgTalkTime, formatTalkDuration } from "@/lib/daily-call-telemetry"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const timezone = sanitizeIanaTimezone(req.nextUrl.searchParams.get("timezone"))

  try {
    const metrics = await getDailyCallTelemetryForOwner(userId, organizationId, timezone)
    return NextResponse.json({
      data: {
        ...metrics,
        avg_talk_time_display: formatAvgTalkTime(metrics.avg_talk_seconds),
        daily_talk_time_display: formatTalkDuration(metrics.daily_talk_seconds),
        weekly_talk_time_display: formatTalkDuration(metrics.weekly_talk_seconds),
        owner_user_id: metrics.telemetry_owner_user_id,
        organization_id: organizationId,
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/telemetry] failed:", e)
    return NextResponse.json({ error: "Could not load call telemetry" }, { status: 500 })
  }
}
