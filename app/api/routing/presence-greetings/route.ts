// GET/PUT /api/routing/presence-greetings — On-Job / Closed scripts + dispatch overrides.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

function serializePresence(presence: Awaited<ReturnType<typeof getAccountPresence>>) {
  return {
    onJobGreetingText: presence.onJobGreetingText,
    closedGreetingText: presence.closedGreetingText,
    on_job_greeting_text: presence.onJobGreetingText,
    closed_greeting_text: presence.closedGreetingText,
    ivrBypassCode: presence.ivrBypassCode,
    ivr_bypass_code: presence.ivrBypassCode,
    ivrVoiceEngineModel: presence.ivrVoiceEngineModel,
    ivr_voice_engine_model: presence.ivrVoiceEngineModel,
    holidayOverrideStart: presence.holidayOverrideStart,
    holiday_override_start: presence.holidayOverrideStart,
    holidayOverrideEnd: presence.holidayOverrideEnd,
    holiday_override_end: presence.holidayOverrideEnd,
    holidayGreetingText: presence.holidayGreetingText,
    holiday_greeting_text: presence.holidayGreetingText,
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

  try {
    const presence = await getAccountPresence(userId)
    return NextResponse.json({ data: serializePresence(presence) })
  } catch (e) {
    console.error("[GET /api/routing/presence-greetings]", e)
    return NextResponse.json({
      data: serializePresence({
        presenceStatus: "AVAILABLE",
        presenceClosedManual: false,
        onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
        closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
        ivrBypassCode: null,
        ivrVoiceEngineModel: DEFAULT_IVR_VOICE_ENGINE_MODEL,
        holidayOverrideStart: null,
        holidayOverrideEnd: null,
        holidayGreetingText: null,
      }),
    })
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

  const existing = await getAccountPresence(userId)

  const onJobRaw = pickString(body, [
    "onJobGreetingText",
    "on_job_greeting_text",
    "onJobGreeting",
  ])
  const closedRaw = pickString(body, [
    "closedGreetingText",
    "closed_greeting_text",
    "closedGreeting",
  ])
  const bypassRaw = pickNullableString(body, ["ivrBypassCode", "ivr_bypass_code", "bypassCode"])
  const voiceRaw = pickString(body, [
    "ivrVoiceEngineModel",
    "ivr_voice_engine_model",
    "voicePersona",
  ])
  const holidayStartRaw = pickNullableString(body, [
    "holidayOverrideStart",
    "holiday_override_start",
  ])
  const holidayEndRaw = pickNullableString(body, ["holidayOverrideEnd", "holiday_override_end"])
  const holidayTextRaw = pickNullableString(body, [
    "holidayGreetingText",
    "holiday_greeting_text",
  ])

  try {
    const saved = await setAccountPresenceGreetings({
      ownerUserId: userId,
      onJobGreetingText:
        typeof onJobRaw === "string" ? onJobRaw : existing.onJobGreetingText,
      closedGreetingText:
        typeof closedRaw === "string" ? closedRaw : existing.closedGreetingText,
      ivrBypassCode: bypassRaw !== undefined ? bypassRaw : existing.ivrBypassCode,
      ivrVoiceEngineModel:
        typeof voiceRaw === "string" ? voiceRaw : existing.ivrVoiceEngineModel,
      holidayOverrideStart:
        holidayStartRaw !== undefined ? holidayStartRaw : existing.holidayOverrideStart,
      holidayOverrideEnd:
        holidayEndRaw !== undefined ? holidayEndRaw : existing.holidayOverrideEnd,
      holidayGreetingText:
        holidayTextRaw !== undefined ? holidayTextRaw : existing.holidayGreetingText,
    })
    return NextResponse.json({ data: serializePresence(saved) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (
      code === "IVR_DISPATCH_MIGRATION_REQUIRED" ||
      msg.includes("101-ivr-automation-dispatch")
    ) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/101-ivr-automation-dispatch.sql",
        },
        { status: 503 }
      )
    }
    if (
      code === "PRESENCE_GREETINGS_MIGRATION_REQUIRED" ||
      msg.includes("100-presence-automation-greetings")
    ) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/100-presence-automation-greetings.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/presence-greetings]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
