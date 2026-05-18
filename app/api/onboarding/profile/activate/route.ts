import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { activateOnboardingSubscription } from "@/lib/onboarding-activate-subscription"
import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"

/** Mock Stripe checkout — sets has_active_subscription and starts Telnyx provision. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    await req.json().catch(() => ({}))
    const profile = await activateOnboardingSubscription(userId)
    const display =
      profile.reserved_number_display?.trim() || profile.reserved_number?.trim() || "your line"
    return NextResponse.json({
      data: profile,
      simulation_mode: isOnboardingTelnyxSimulationMode(),
      message: `Subscription activated! Telnyx carrier routing provisioning successfully initiated for ${display}.`,
    })
  } catch (e) {
    console.error("[onboarding/profile/activate POST]", e)
    const msg = e instanceof Error ? e.message : "Activation failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
