import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { activateOnboardingSubscription } from "@/lib/onboarding-activate-subscription"
import { isReservedLineCarrierLive } from "@/lib/onboarding-line-carrier-status"
import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"

/** Activates subscription when billing is on file; optional save_billing_method from dashboard card modal. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const saveBillingMethod =
      body && typeof body === "object" && (body as Record<string, unknown>).save_billing_method === true
    const profile = await activateOnboardingSubscription(userId, { saveBillingMethod })
    const display =
      profile.reserved_number_display?.trim() || profile.reserved_number?.trim() || "your line"
    const carrier_live = await isReservedLineCarrierLive(userId, profile.reserved_number)
    const simulation = isOnboardingTelnyxSimulationMode()
    const message = profile.has_active_subscription
      ? carrier_live
        ? `Live production enabled for ${display}. Inbound calls will route to your configured phones.`
        : `Subscription activated for ${display}. Carrier provisioning will complete when Telnyx confirms your number.`
      : `Could not activate ${display}. Add a payment method and try again.`
    return NextResponse.json({
      data: profile,
      carrier_live,
      subscription_active: profile.has_active_subscription === true,
      simulation_mode: simulation,
      message,
    })
  } catch (e) {
    console.error("[onboarding/profile/activate POST]", e)
    const msg = e instanceof Error ? e.message : "Activation failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
