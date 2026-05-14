// ============================================
// GET/PUT /api/routing
// ============================================
// Get or update call routing configuration.
// Supports per-number routing via ?number=+15025571219 query param.
// Without the param, operates on the default/global config.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getUser,
  getRoutingConfig,
  getRoutingConfigForNumber,
  getAllRoutingConfigs,
  updateRoutingConfig,
  getPhoneNumbers,
  getReceptionist,
  normalizePhoneNumberE164,
} from "@/lib/db"
import type { UpdateRoutingRequest } from "@/lib/types"
import {
  ensureTelnyxVoiceAiAssistant,
  syncTelnyxAssistantFromIntakeOrRecover,
  type EnsureTelnyxVoiceAiResult,
} from "@/lib/telnyx-ai-assistant-lifecycle"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const number = req.nextUrl.searchParams.get("number")
    const all = req.nextUrl.searchParams.get("all")

    // ?all=true → return every config (default + per-number)
    if (all === "true") {
      const configs = await getAllRoutingConfigs(userId)
      return NextResponse.json({ configs })
    }

    // ?number=+1xxx → return config for that specific number (with fallback to default)
    if (number) {
      const config = await getRoutingConfigForNumber(userId, number)
      const effective = req.nextUrl.searchParams.get("effective")
      if (effective === "1" || effective === "true") {
        const sid = config?.selected_receptionist_id?.trim() || ""
        let receptionist_name: string | null = null
        let receptionist_phone_last4: string | null = null
        let receptionist_active: boolean | null = null
        if (sid) {
          const rec = await getReceptionist(sid)
          if (rec && String(rec.user_id) === String(userId)) {
            receptionist_name = rec.name
            receptionist_active = rec.is_active
            const d = normalizePhoneNumberE164(rec.phone).replace(/\D/g, "")
            receptionist_phone_last4 = d.length >= 4 ? d.slice(-4) : null
          }
        }
        const u = await getUser(userId)
        const ownerDigits = u?.phone ? normalizePhoneNumberE164(u.phone).replace(/\D/g, "") : ""
        const owner_phone_last4 = ownerDigits.length >= 4 ? ownerDigits.slice(-4) : null
        return NextResponse.json({
          config,
          effective: {
            first_pstn_leg: sid && receptionist_phone_last4 ? "receptionist" : "owner_cell",
            receptionist_id: sid || null,
            receptionist_name,
            receptionist_phone_last4,
            receptionist_active,
            owner_phone_last4,
          },
        })
      }
      return NextResponse.json({ config })
    }

    // No params → return default config
    const config = await getRoutingConfig(userId)
    return NextResponse.json({ config })
  } catch (error) {
    console.error("[Zing] Error fetching routing config:", error)
    return NextResponse.json({ error: "Failed to fetch routing config" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body: UpdateRoutingRequest & { business_number?: string } = await req.json()
    const businessNumber =
      typeof body.business_number === "string" && body.business_number.trim() !== ""
        ? body.business_number.trim()
        : null

    const touchesPerLineRouting =
      body.selected_receptionist_id !== undefined ||
      body.fallback_type !== undefined ||
      body.ai_greeting !== undefined ||
      body.ring_timeout_seconds !== undefined

    if (touchesPerLineRouting && businessNumber == null) {
      const nums = await getPhoneNumbers(userId)
      const activeLines = nums.filter((n) => n.status === "active").length
      if (activeLines >= 2) {
        return NextResponse.json(
          {
            error:
              "Which line is this for? On the dashboard tap the business number, then save again so we can store routing for that line (not only the account default).",
          },
          { status: 400 }
        )
      }
    }

    await updateRoutingConfig(
      userId,
      {
        selected_receptionist_id: body.selected_receptionist_id,
        fallback_type: body.fallback_type,
        ai_greeting: body.ai_greeting,
        ring_timeout_seconds: body.ring_timeout_seconds,
        ai_ring_owner_first: body.ai_ring_owner_first,
      },
      businessNumber
    )

    const updated = businessNumber
      ? await getRoutingConfigForNumber(userId, businessNumber)
      : await getRoutingConfig(userId)

    let voiceAi: EnsureTelnyxVoiceAiResult | undefined
    // Any time effective routing is AI, try to link/create Telnyx assistant (idempotent if already linked).
    // Previously we only ran when this request included fallback_type or ai_greeting — so changing
    // receptionist (or other fields) skipped retries and left users with fallback=ai but no assistant id → voicemail.
    const shouldProvisionVoiceAi = updated?.fallback_type === "ai"
    if (shouldProvisionVoiceAi) {
      voiceAi = await ensureTelnyxVoiceAiAssistant(userId, {
        greeting: typeof body.ai_greeting === "string" ? body.ai_greeting : undefined,
      })
      if (typeof body.ai_greeting === "string") {
        const u = await getUser(userId)
        if (u?.telnyx_ai_assistant_id?.trim()) {
          const syncR = await syncTelnyxAssistantFromIntakeOrRecover(userId)
          if (syncR.error) console.error("[PUT /api/routing] Telnyx sync after greeting:", syncR.error)
        }
      }
    }

    return NextResponse.json({ config: updated, ...(voiceAi ? { voiceAi } : {}) })
  } catch (error) {
    console.error("[Zing] Error updating routing config:", error)
    return NextResponse.json({ error: "Failed to update routing config" }, { status: 500 })
  }
}
