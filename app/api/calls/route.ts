// ============================================
// GET /api/calls
// ============================================
// Returns call history for the dashboard and activity pages.
// Supports filtering by type and pagination.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { buildCallActivityContextMap } from "@/lib/activity-call-context"
import { fetchCallActivityEnrichmentRows, getCallLogs, normalizePhoneNumberE164 } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const type = searchParams.get("type") || undefined // incoming, outgoing, missed, voicemail

    const calls = await getCallLogs(userId, { limit, offset, type })

    const callLogIds = calls.map((call) => call.id)
    const phoneE164ByCallId = new Map<string, string>()
    const callerPhonesE164: string[] = []
    for (const call of calls) {
      try {
        const phone = normalizePhoneNumberE164(call.from_number)
        phoneE164ByCallId.set(call.id, phone)
        callerPhonesE164.push(phone)
      } catch {
        /* skip invalid numbers */
      }
    }

    const { leadRows, customerCallLogIds } = await fetchCallActivityEnrichmentRows(
      userId,
      callLogIds,
      callerPhonesE164
    )

    const activityByCallId = buildCallActivityContextMap({
      calls: calls.map((call) => ({
        id: call.id,
        from_number: phoneE164ByCallId.get(call.id) ?? call.from_number,
        disposition: call.disposition ?? null,
      })),
      leadRows,
      customerCallLogIds,
      phoneE164ByCallId,
    })

    const enrichedCalls = calls.map((call) => ({
      ...call,
      activity: activityByCallId.get(call.id) ?? null,
    }))

    return NextResponse.json({ calls: enrichedCalls })
  } catch (error) {
    console.error("[Sigo] Error fetching calls:", error)
    return NextResponse.json(
      { error: "Failed to fetch call logs" },
      { status: 500 }
    )
  }
}
