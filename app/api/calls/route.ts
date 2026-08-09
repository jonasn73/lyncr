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
    const rawLimit = parseInt(searchParams.get("limit") || "50", 10)
    const rawOffset = parseInt(searchParams.get("offset") || "0", 10)
    // Cap page size — clients used to request unbounded history.
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
    const type = searchParams.get("type") || undefined // incoming, outgoing, missed, voicemail

    const calls = await getCallLogs(userId, { limit, offset, type })

    const callLogIds = calls.map((call) => call.id)
    const phoneE164ByCallId = new Map<string, string>()
    const callerPhonesE164: string[] = []
    for (const call of calls) {
      const phone = normalizePhoneNumberE164(call.from_number)
      if (!phone) continue
      phoneE164ByCallId.set(call.id, phone)
      callerPhonesE164.push(phone)
    }

    let leadRows: Record<string, unknown>[] = []
    let customerCallLogIds = new Set<string>()
    let customerNameByPhone = new Map<string, string>()
    try {
      const enrichment = await fetchCallActivityEnrichmentRows(userId, callLogIds, callerPhonesE164)
      leadRows = enrichment.leadRows
      customerCallLogIds = enrichment.customerCallLogIds
      customerNameByPhone = enrichment.customerNameByPhone
    } catch (enrichError) {
      console.error("[GET /api/calls] activity enrichment failed:", enrichError)
    }

    const activityByCallId = buildCallActivityContextMap({
      calls: calls.map((call) => ({
        id: call.id,
        from_number: phoneE164ByCallId.get(call.id) ?? call.from_number,
        created_at: call.created_at,
        disposition: call.disposition ?? null,
      })),
      leadRows,
      customerCallLogIds,
      phoneE164ByCallId,
    })

    const enrichedCalls = calls.map((call) => {
      const phone = phoneE164ByCallId.get(call.id) ?? ""
      const crmName = phone ? customerNameByPhone.get(phone) : undefined
      const existingName = String(call.caller_name || "").trim()
      const looksUnknown =
        !existingName ||
        /^unknown(\s+caller)?$/i.test(existingName) ||
        existingName === "—"
      return {
        ...call,
        // Prefer CRM display name when the log still says Unknown Caller.
        caller_name: looksUnknown && crmName ? crmName : call.caller_name,
        activity: activityByCallId.get(call.id) ?? null,
      }
    })

    return NextResponse.json({ calls: enrichedCalls })
  } catch (error) {
    console.error("[lyncr] Error fetching calls:", error)
    return NextResponse.json(
      { error: "Failed to fetch call logs" },
      { status: 500 }
    )
  }
}
