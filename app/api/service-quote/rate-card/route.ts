// GET /api/service-quote/rate-card — owner quote profile from onboarding_profiles.service_rules.

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { getOwnerServiceRateCard } from "@/lib/service-rate-card"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "owner_intake_form",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

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
