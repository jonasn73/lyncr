// ============================================
// GET /api/owner/lead-salvage
// ============================================
// Owner-scoped feed of PRICE_REJECTED leads flagged salvageable by an operator. Powers the
// "Lyncr Lead Salvage" card grid so the owner can click-to-call and rescue the deal.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listSalvageableLeads } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const leads = await listSalvageableLeads(userId)
    return NextResponse.json({
      data: {
        leads: leads.map((l) => ({
          id: l.id,
          caller_e164: l.caller_e164,
          summary: l.summary,
          collected: l.collected,
          created_at: l.created_at,
        })),
      },
    })
  } catch (e) {
    console.error("[owner/lead-salvage GET]", e)
    return NextResponse.json({ data: { leads: [] } })
  }
}
