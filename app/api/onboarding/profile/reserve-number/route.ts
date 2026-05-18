// ============================================
// POST /api/onboarding/profile/reserve-number
// ============================================
// Fires when the user completes Step 1 (number selection + Continue).
// Trial/simulation: writes reserved_number to Neon onboarding_profiles only.
// Live Telnyx purchase runs at billing launch (see lib/onboarding-telnyx-provision-placeholder.ts).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { updateOnboardingProfile } from "@/lib/db"
import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"
import type { UpdateOnboardingProfileRequest } from "@/lib/types"

function parseReserveBody(body: unknown): UpdateOnboardingProfileRequest | null {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const e164 = o.reserved_number != null ? String(o.reserved_number).trim() : ""
  if (!e164) return null
  const method = o.reserved_number_method
  return {
    reserved_number: e164,
    reserved_number_display:
      o.reserved_number_display != null ? String(o.reserved_number_display).trim() || null : null,
    reserved_number_method: method === "port" ? "port" : "buy",
    port_carrier: o.port_carrier != null ? String(o.port_carrier).trim() || null : null,
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const updates = parseReserveBody(body)
    if (!updates?.reserved_number) {
      return NextResponse.json({ error: "reserved_number is required" }, { status: 400 })
    }

    const simulation = isOnboardingTelnyxSimulationMode()

    if (!simulation && updates.reserved_number_method === "buy") {
      // -----------------------------------------------------------------------
      // TODO: Production Telnyx Integration (optional early reserve at Step 1)
      // -----------------------------------------------------------------------
      // Today we only persist reserved_number in Neon here. Live purchase runs
      // at POST /api/onboarding/profile/complete when ONBOARDING_LIVE_TELNYX_PROVISION=true.
      //
      // To buy immediately on Continue instead of at launch, call:
      //   runOnboardingTelnyxProvisionPlaceholder(updates.reserved_number)
      // or inline:
      //
      // const response = await fetch("https://api.telnyx.com/v2/number_orders", {
      //   method: "POST",
      //   headers: {
      //     Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify({
      //     phone_numbers: [{ phone_number: updates.reserved_number }],
      //   }),
      // })
      // -----------------------------------------------------------------------
    }

    // Simulation / trial: Neon reservation only — no carrier API call.
    const profile = await updateOnboardingProfile(userId, updates)

    return NextResponse.json({
      data: profile,
      simulation_mode: simulation,
    })
  } catch (e) {
    console.error("[onboarding/profile/reserve-number POST]", e)
    const msg = e instanceof Error ? e.message : "Failed to reserve number"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
