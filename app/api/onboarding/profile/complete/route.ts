import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { completeOnboardingCheckout } from "@/lib/db"
import { parsePatchBody } from "@/app/api/onboarding/profile/route"
import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const patch = parsePatchBody(body)
    const profile = await completeOnboardingCheckout(userId, patch)
    return NextResponse.json({
      data: profile,
      simulation_mode: isOnboardingTelnyxSimulationMode(),
    })
  } catch (e) {
    console.error("[onboarding/profile/complete POST]", e)
    const msg = e instanceof Error ? e.message : "Failed to complete checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
