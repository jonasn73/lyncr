import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { rejectIfShopNotUsable } from "@/lib/admin-api-guard"
import { updateOnboardingProfile } from "@/lib/db"
import { evaluateNumberReservationGate } from "@/lib/number-allocation"
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
  const locked = await rejectIfShopNotUsable(userId)
  if (locked) return locked

  try {
    const body = await req.json().catch(() => ({}))
    const updates = parseReserveBody(body)
    if (!updates?.reserved_number) {
      return NextResponse.json({ error: "reserved_number is required" }, { status: 400 })
    }

    const gate = await evaluateNumberReservationGate(userId, updates.reserved_number)
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: gate.message,
          reason: gate.reason,
          upgrade_message: gate.upgrade_message,
          subscription_tier: gate.tier,
        },
        { status: 403 }
      )
    }

    const simulation = isOnboardingTelnyxSimulationMode()
    void simulation

    const profile = await updateOnboardingProfile(userId, updates)

    try {
      const { syncOnboardingLineToPhoneNumbers } = await import("@/lib/db")
      await syncOnboardingLineToPhoneNumbers(userId, profile)
    } catch (syncErr) {
      console.error("[onboarding/profile/reserve-number] sync phone_numbers:", syncErr)
    }

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
