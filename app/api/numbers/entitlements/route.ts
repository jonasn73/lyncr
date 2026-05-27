import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { evaluateNumberPurchaseGate } from "@/lib/number-allocation"
import { getOnboardingProfile } from "@/lib/db"
import {
  CARRIER_PROVISIONING_FEE_USD,
  TIER_DISPLAY_NAME,
  tierUpgradeTarget,
} from "@/lib/subscription-tier"
import { hasPaidStripeSubscription } from "@/lib/onboarding-subscription-status"

/** GET /api/numbers/entitlements — tier limits + carrier credit before buying a line. */
export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const gate = await evaluateNumberPurchaseGate(userId)
    const upgradeTarget = tierUpgradeTarget(gate.tier)
    const profile = await getOnboardingProfile(userId)

    return NextResponse.json({
      data: {
        allowed: gate.allowed,
        reason: gate.allowed ? null : gate.reason,
        message: gate.allowed ? null : gate.message,
        upgrade_message: gate.allowed ? null : gate.upgrade_message,
        subscription_tier: gate.tier,
        subscription_tier_label: TIER_DISPLAY_NAME[gate.tier],
        subscription_active: hasPaidStripeSubscription(profile),
        upgrade_target_tier: upgradeTarget,
        upgrade_target_label: upgradeTarget ? TIER_DISPLAY_NAME[upgradeTarget] : null,
        active_number_count: gate.active_count,
        line_limit: gate.line_limit,
        carrier_credit: gate.carrier_credit,
        provisioning_fee_usd: CARRIER_PROVISIONING_FEE_USD,
      },
    })
  } catch (e) {
    console.error("[numbers/entitlements GET]", e)
    return NextResponse.json({ error: "Could not load number entitlements" }, { status: 500 })
  }
}
