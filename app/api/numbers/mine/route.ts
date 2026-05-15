// ============================================
// GET /api/numbers/mine
// ============================================
// Returns the authenticated user's business phone numbers from the database.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPhoneNumbers, getRoutingConfigForNumber, getUser } from "@/lib/db"
import type { FallbackType, PhoneNumberRoutingSummary } from "@/lib/types"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const [numbers, account] = await Promise.all([getPhoneNumbers(userId), getUser(userId)])
    const assistantLinked = Boolean(account?.telnyx_ai_assistant_id?.trim())

    const numbersWithRouting = await Promise.all(
      numbers.map(async (row) => {
        const cfg = await getRoutingConfigForNumber(userId, row.number)
        const fb = (cfg?.fallback_type ?? "owner") as FallbackType
        const aiSelected = fb === "ai"
        const routing_summary: PhoneNumberRoutingSummary = {
          fallback_type: fb,
          ai_fallback_selected: aiSelected,
          telnyx_assistant_linked: assistantLinked,
          ai_fallback_live: aiSelected && assistantLinked,
          ring_first_receptionist_id: cfg?.selected_receptionist_id ?? null,
        }
        return { ...row, routing_summary }
      })
    )

    return NextResponse.json({ numbers: numbersWithRouting })
  } catch (error) {
    console.error("[Sigo] Error fetching user numbers:", error)
    return NextResponse.json({ error: "Failed to load numbers" }, { status: 500 })
  }
}
