// ============================================
// PATCH /api/user/profile
// ============================================
// Update the current user's profile (main line / cell, name). Requires session.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { updateUser } from "@/lib/db"
import { AI_INTAKE_PROFILE_IDS } from "@/lib/business-industries"

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return phone.startsWith("+") ? phone : `+${digits}`
}

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = await req.json()
    const allowedIndustry = new Set(AI_INTAKE_PROFILE_IDS)
    const updates: {
      phone?: string
      name?: string
      business_name?: string
      inbound_receptionist_whisper_enabled?: boolean
      answered_call_customer_popup_enabled?: boolean
      industry?: string
      shop_address?: string | null
      shop_latitude?: number | null
      shop_longitude?: number | null
    } = {}
    if (typeof body?.phone === "string" && body.phone.trim()) {
      updates.phone = normalizePhone(body.phone.trim())
    }
    if (typeof body?.name === "string") {
      updates.name = body.name.trim() || undefined
    }
    if (typeof body?.business_name === "string") {
      updates.business_name = body.business_name.trim() || undefined
    }
    if (typeof body?.inbound_receptionist_whisper_enabled === "boolean") {
      updates.inbound_receptionist_whisper_enabled = body.inbound_receptionist_whisper_enabled
    }
    if (typeof body?.answered_call_customer_popup_enabled === "boolean") {
      updates.answered_call_customer_popup_enabled = body.answered_call_customer_popup_enabled
    }
    if (typeof body?.industry === "string") {
      const ind = body.industry.trim().toLowerCase()
      if (allowedIndustry.has(ind)) updates.industry = ind
    }
    // Shop address is only useful with coordinates — an address we could not geocode
    // would leave travel distance measuring from the old shop with a new label.
    if ("shop_address" in (body ?? {})) {
      const raw = body.shop_address
      const address = typeof raw === "string" ? raw.trim() : ""
      if (!address) {
        updates.shop_address = null
        updates.shop_latitude = null
        updates.shop_longitude = null
      } else {
        const lat = Number(body.shop_latitude)
        const lng = Number(body.shop_longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return NextResponse.json(
            { error: "Pick the shop address from the suggestions so it can be mapped" },
            { status: 400 }
          )
        }
        updates.shop_address = address
        updates.shop_latitude = lat
        updates.shop_longitude = lng
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: phone, name, business_name, inbound_receptionist_whisper_enabled, answered_call_customer_popup_enabled, industry",
        },
        { status: 400 }
      )
    }
    await updateUser(userId, updates)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    console.error("[lyncr] Update profile error:", error)
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    )
  }
}
