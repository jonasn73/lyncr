// GET /api/service-quote/rate-card — owner quote profile from onboarding_profiles.service_rules.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerServiceRateCard } from "@/lib/service-rate-card"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const { rateCard, source } = await getOwnerServiceRateCard(userId)
    return NextResponse.json({
      data: {
        rate_card: rateCard,
        source,
      },
    })
  } catch (e) {
    console.error("[GET /api/service-quote/rate-card]", e)
    return NextResponse.json({ error: "Failed to load rate card" }, { status: 500 })
  }
}
