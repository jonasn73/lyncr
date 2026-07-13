// GET/PUT active routing mode for Lines Who Answers.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  normalizeActiveRoutingMode,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"
import {
  applyActiveRoutingMode,
  getActiveRoutingState,
} from "@/lib/active-routing-mode-db"
import { getIvrMenuSettingsForOwnerLine } from "@/lib/ivr-menu-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numberParam = req.nextUrl.searchParams.get("number")?.trim() || null
  const businessNumber = numberParam ? normalizePhoneNumberE164(numberParam) : null

  try {
    const state = await getActiveRoutingState(userId, businessNumber)
    const ivr = await getIvrMenuSettingsForOwnerLine(userId, businessNumber)
    return NextResponse.json({
      data: {
        ...state,
        ivrGreetingText: ivr.ivrGreetingText,
        ivrOption1Action: ivr.ivrOption1Action,
        ivrOption2Action: ivr.ivrOption2Action,
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/mode]", e)
    return NextResponse.json({ error: "Failed to load routing mode" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const numberRaw =
    (typeof body.business_number === "string" && body.business_number) ||
    (typeof body.number === "string" && body.number) ||
    null
  const businessNumber = numberRaw ? normalizePhoneNumberE164(numberRaw) : null
  const mode = normalizeActiveRoutingMode(
    body.active_routing_mode ?? body.activeRoutingMode ?? body.mode
  ) as ActiveRoutingMode
  const customPhone =
    typeof body.custom_routing_phone === "string"
      ? body.custom_routing_phone
      : typeof body.customRoutingPhone === "string"
        ? body.customRoutingPhone
        : null
  const ringTimeout =
    typeof body.ring_timeout_seconds === "number"
      ? body.ring_timeout_seconds
      : typeof body.ringTimeoutSeconds === "number"
        ? body.ringTimeoutSeconds
        : undefined

  try {
    const saved = await applyActiveRoutingMode({
      ownerUserId: userId,
      businessNumber,
      mode,
      customRoutingPhone: customPhone,
      ringTimeoutSeconds: ringTimeout,
    })
    return NextResponse.json({ data: saved })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "ROUTING_MODE_MIGRATION_REQUIRED") {
      return NextResponse.json(
        { error: msg, migration: "scripts/089-active-routing-mode-and-deposits.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/mode]", e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
