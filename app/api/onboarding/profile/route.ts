import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOnboardingProfile, updateOnboardingProfile } from "@/lib/db"
import { isReservedLineCarrierLive } from "@/lib/onboarding-line-carrier-status"
import type { UpdateOnboardingProfileRequest } from "@/lib/types"

export function parsePatchBody(body: unknown): UpdateOnboardingProfileRequest {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const out: UpdateOnboardingProfileRequest = {}

  if ("reserved_number" in o) {
    const v = o.reserved_number
    out.reserved_number = v == null ? null : String(v).trim() || null
  }
  if ("reserved_number_display" in o) {
    const v = o.reserved_number_display
    out.reserved_number_display = v == null ? null : String(v).trim() || null
  }
  if ("reserved_number_method" in o) {
    const m = o.reserved_number_method
    out.reserved_number_method = m === "buy" || m === "port" ? m : null
  }
  if ("port_carrier" in o) {
    const v = o.port_carrier
    out.port_carrier = v == null ? null : String(v).trim() || null
  }
  if ("fallback_type" in o) {
    const f = o.fallback_type
    out.fallback_type = f === "ai" || f === "voicemail" ? f : null
  }
  if ("trade_category" in o) {
    const v = o.trade_category
    out.trade_category = v == null ? null : String(v).trim() || null
  }
  if ("opening_line" in o) {
    const v = o.opening_line
    out.opening_line = v == null ? null : String(v)
  }
  if ("has_active_subscription" in o) {
    out.has_active_subscription = Boolean(o.has_active_subscription)
  }

  return out
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const profile = await getOnboardingProfile(userId)
    const carrier_live = profile?.reserved_number
      ? await isReservedLineCarrierLive(userId, profile.reserved_number)
      : false
    return NextResponse.json({ data: profile, carrier_live })
  } catch (e) {
    console.error("[onboarding/profile GET]", e)
    const msg = e instanceof Error ? e.message : "Failed to load profile"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const updates = parsePatchBody(body)
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }
    const profile = await updateOnboardingProfile(userId, updates)
    return NextResponse.json({ data: profile })
  } catch (e) {
    console.error("[onboarding/profile PATCH]", e)
    const msg = e instanceof Error ? e.message : "Failed to save profile"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
