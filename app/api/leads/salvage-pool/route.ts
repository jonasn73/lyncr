// GET /api/leads/salvage-pool — unified PRICE_REJECTED ai_leads + lost_leads salvage queue.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listUnifiedSalvagePool } from "@/lib/salvage-pool"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "50")
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50
    const { entries, counts } = await listUnifiedSalvagePool(userId, limit)

    return NextResponse.json({
      data: {
        entries,
        counts,
        /** @deprecated Use entries — kept for leads cache compatibility. */
        leads: entries.map((e) => ({
          id: e.id,
          source: e.source,
          caller_e164: e.caller_e164,
          summary: e.summary,
          collected: e.collected,
          created_at: e.created_at,
          status: e.status,
          failure_reason: e.failure_reason,
          last_quoted_price_cents: e.last_quoted_price_cents,
          manual_retry_required: e.manual_retry_required,
          recovery_blocked_reason: e.recovery_blocked_reason,
          has_receptionist_log: e.has_receptionist_log,
        })),
      },
    })
  } catch (e) {
    console.error("[GET /api/leads/salvage-pool]", e)
    return NextResponse.json({ data: { entries: [], counts: { ai_lead: 0, lost_lead: 0, manual_retry: 0 }, leads: [] } })
  }
}
