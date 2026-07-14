// GET/PUT unified Call Flow configure payload (mode + greetings + security + fallback).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { normalizePhoneNumberE164, updateRoutingConfig, getRoutingConfigForNumber, getRoutingConfig } from "@/lib/db"
import {
  normalizeActiveRoutingMode,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"
import {
  applyActiveRoutingMode,
  getActiveRoutingState,
} from "@/lib/active-routing-mode-db"
import {
  DEFAULT_CLOSED_GREETING_TEXT,
  DEFAULT_ON_JOB_GREETING_TEXT,
  getAccountPresence,
  setAccountPresenceGreetings,
} from "@/lib/account-presence"
import {
  DEFAULT_IVR_VOICE_ENGINE_MODEL,
  IVR_VOICE_PERSONA_OPTIONS,
} from "@/lib/ivr-automation-settings"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function pickString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key]
    if (typeof v === "string") return v
  }
  return undefined
}

function pickNullableString(body: Record<string, unknown>, keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (!(key in body)) continue
    const v = body[key]
    if (v == null) return null
    if (typeof v === "string") return v
  }
  return undefined
}

function serializeConfigure(
  modeState: Awaited<ReturnType<typeof getActiveRoutingState>>,
  presence: Awaited<ReturnType<typeof getAccountPresence>>,
  fallbackType: string
) {
  return {
    activeRoutingMode: modeState.activeRoutingMode,
    customRoutingPhone: modeState.customRoutingPhone,
    ringTimeoutSeconds: modeState.ringTimeoutSeconds,
    fallbackType,
    onJobGreetingText: presence.onJobGreetingText,
    closedGreetingText: presence.closedGreetingText,
    ivrBypassCode: presence.ivrBypassCode,
    ivrVoiceEngineModel: presence.ivrVoiceEngineModel,
    holidayOverrideStart: presence.holidayOverrideStart,
    holidayOverrideEnd: presence.holidayOverrideEnd,
    holidayGreetingText: presence.holidayGreetingText,
    defaults: {
      onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
      closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
      ivrVoiceEngineModel: DEFAULT_IVR_VOICE_ENGINE_MODEL,
    },
    voicePersonas: IVR_VOICE_PERSONA_OPTIONS.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description,
    })),
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numberParam = req.nextUrl.searchParams.get("number")?.trim() || null
  const businessNumber = numberParam ? normalizePhoneNumberE164(numberParam) : null

  try {
    const [modeState, presence, routing] = await Promise.all([
      getActiveRoutingState(userId, businessNumber),
      getAccountPresence(userId),
      businessNumber
        ? getRoutingConfigForNumber(userId, businessNumber)
        : getRoutingConfig(userId),
    ])
    return NextResponse.json({
      data: serializeConfigure(modeState, presence, routing?.fallback_type || "owner"),
    })
  } catch (e) {
    console.error("[GET /api/routing/configure]", e)
    return NextResponse.json({ error: "Failed to load call flow configuration" }, { status: 500 })
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

  const fallbackRaw = String(body.fallback_type ?? body.fallbackType ?? "").toLowerCase()
  const fallbackType =
    fallbackRaw === "ai" || fallbackRaw === "voicemail" || fallbackRaw === "owner"
      ? (fallbackRaw as "ai" | "voicemail" | "owner")
      : undefined

  try {
    const existingPresence = await getAccountPresence(userId)

    const onJobRaw = pickString(body, ["onJobGreetingText", "on_job_greeting_text"])
    const closedRaw = pickString(body, ["closedGreetingText", "closed_greeting_text"])
    const bypassRaw = pickNullableString(body, ["ivrBypassCode", "ivr_bypass_code"])
    const voiceRaw = pickString(body, ["ivrVoiceEngineModel", "ivr_voice_engine_model"])
    const holidayStartRaw = pickNullableString(body, [
      "holidayOverrideStart",
      "holiday_override_start",
    ])
    const holidayEndRaw = pickNullableString(body, ["holidayOverrideEnd", "holiday_override_end"])
    const holidayTextRaw = pickNullableString(body, [
      "holidayGreetingText",
      "holiday_greeting_text",
    ])

    // One request commits mode + greetings/security + classic fallback together.
    const [modeSaved, presenceSaved] = await Promise.all([
      applyActiveRoutingMode({
        ownerUserId: userId,
        businessNumber,
        mode,
        customRoutingPhone: customPhone,
        ringTimeoutSeconds: ringTimeout,
      }),
      setAccountPresenceGreetings({
        ownerUserId: userId,
        onJobGreetingText:
          typeof onJobRaw === "string" ? onJobRaw : existingPresence.onJobGreetingText,
        closedGreetingText:
          typeof closedRaw === "string" ? closedRaw : existingPresence.closedGreetingText,
        ivrBypassCode: bypassRaw !== undefined ? bypassRaw : existingPresence.ivrBypassCode,
        ivrVoiceEngineModel:
          typeof voiceRaw === "string" ? voiceRaw : existingPresence.ivrVoiceEngineModel,
        holidayOverrideStart:
          holidayStartRaw !== undefined
            ? holidayStartRaw
            : existingPresence.holidayOverrideStart,
        holidayOverrideEnd:
          holidayEndRaw !== undefined ? holidayEndRaw : existingPresence.holidayOverrideEnd,
        holidayGreetingText:
          holidayTextRaw !== undefined
            ? holidayTextRaw
            : existingPresence.holidayGreetingText,
      }),
    ])

    await updateRoutingConfig(
      userId,
      {
        selected_receptionist_id: null,
        ...(fallbackType ? { fallback_type: fallbackType } : {}),
        ...(mode === "your_phone" && typeof ringTimeout === "number"
          ? { ring_timeout_seconds: ringTimeout }
          : {}),
      },
      businessNumber
    )

    const routing = businessNumber
      ? await getRoutingConfigForNumber(userId, businessNumber)
      : await getRoutingConfig(userId)

    return NextResponse.json({
      data: serializeConfigure(
        modeSaved,
        presenceSaved,
        routing?.fallback_type || fallbackType || "owner"
      ),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "ROUTING_MODE_MIGRATION_REQUIRED") {
      return NextResponse.json(
        { error: msg, migration: "scripts/089-active-routing-mode-and-deposits.sql" },
        { status: 503 }
      )
    }
    if (
      code === "IVR_DISPATCH_MIGRATION_REQUIRED" ||
      code === "PRESENCE_GREETINGS_MIGRATION_REQUIRED" ||
      msg.includes("100-presence") ||
      msg.includes("101-ivr")
    ) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/100-presence-automation-greetings.sql + scripts/101-ivr-automation-dispatch.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/configure]", e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
