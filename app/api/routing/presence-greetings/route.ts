// GET/PUT /api/routing/presence-greetings — On-Job / Closed scripts + dispatch overrides.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  DEFAULT_CLOSED_GREETING_TEXT,
  DEFAULT_ON_JOB_GREETING_TEXT,
  getAccountPresence,
  setAccountPresenceGreetings,
} from "@/lib/account-presence"
import { getAccountHoldSettings, setAccountHoldSettings } from "@/lib/call-queue-db"
import { holdMaxWaitSecs, holdRePromptIntervalMs } from "@/lib/hold-queue"
import {
  defaultIvrVoiceEngineModel,
  elevenLabsKeyConfigured,
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

function serializePresence(
  presence: Awaited<ReturnType<typeof getAccountPresence>>,
  hold: Awaited<ReturnType<typeof getAccountHoldSettings>> | null = null
) {
  const holdMusicUrl = hold?.holdMusicUrl ?? null
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
    holdMusicUrl,
    hold_music_url: holdMusicUrl,
    holdMaxWaitSecs: hold?.holdMaxWaitSecs ?? null,
    hold_max_wait_secs: hold?.holdMaxWaitSecs ?? null,
    holdRepromptSecs: hold?.holdRepromptSecs ?? null,
    hold_reprompt_secs: hold?.holdRepromptSecs ?? null,
    holdDefaults: {
      maxWaitSecs: holdMaxWaitSecs(),
      repromptSecs: Math.round(holdRePromptIntervalMs() / 1000),
    },
    defaults: {
      onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
      closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
      ivrVoiceEngineModel: defaultIvrVoiceEngineModel(),
    },
    elevenLabsEnabled: elevenLabsKeyConfigured(),
    voicePersonas: IVR_VOICE_PERSONA_OPTIONS.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description,
      requiresElevenLabs: "requiresElevenLabs" in o && o.requiresElevenLabs === true,
    })),
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const presence = await getAccountPresence(userId)
    const hold = await getAccountHoldSettings(userId).catch(() => null)
    return NextResponse.json({ data: serializePresence(presence, hold) })
  } catch (e) {
    console.error("[GET /api/routing/presence-greetings]", e)
    return NextResponse.json({
      data: serializePresence(
        {
          presenceStatus: "AVAILABLE",
          presenceClosedManual: false,
          onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
          closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
          ivrBypassCode: null,
          ivrVoiceEngineModel: defaultIvrVoiceEngineModel(),
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
          ivrCapacityThreshold: 5,
          smartBusyEnabled: false,
        },
        null
      ),
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
  const holdMusicRaw = pickNullableString(body, ["holdMusicUrl", "hold_music_url"])
  const holdMaxWaitRaw = body.holdMaxWaitSecs ?? body.hold_max_wait_secs
  const holdRepromptRaw = body.holdRepromptSecs ?? body.hold_reprompt_secs

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
    if (
      holdMusicRaw !== undefined ||
      holdMaxWaitRaw !== undefined ||
      holdRepromptRaw !== undefined
    ) {
      try {
        await setAccountHoldSettings(userId, {
          ...(holdMusicRaw !== undefined ? { holdMusicUrl: holdMusicRaw } : {}),
          ...(holdMaxWaitRaw !== undefined
            ? {
                holdMaxWaitSecs:
                  holdMaxWaitRaw == null || holdMaxWaitRaw === ""
                    ? null
                    : Number(holdMaxWaitRaw),
              }
            : {}),
          ...(holdRepromptRaw !== undefined
            ? {
                holdRepromptSecs:
                  holdRepromptRaw == null || holdRepromptRaw === ""
                    ? null
                    : Number(holdRepromptRaw),
              }
            : {}),
        })
      } catch (hmErr) {
        const hmCode =
          hmErr instanceof Error && "code" in hmErr
            ? String((hmErr as { code?: string }).code)
            : ""
        if (
          hmCode === "HOLD_QUEUE_MIGRATION_REQUIRED" ||
          hmCode === "HOLD_TUNING_MIGRATION_REQUIRED"
        ) {
          return NextResponse.json(
            {
              error: hmErr instanceof Error ? hmErr.message : "Hold settings need migration",
              migration:
                hmCode === "HOLD_TUNING_MIGRATION_REQUIRED"
                  ? "scripts/130-hold-queue-tuning.sql"
                  : "scripts/129-call-queue.sql",
            },
            { status: 400 }
          )
        }
        throw hmErr
      }
    }
    const hold = await getAccountHoldSettings(userId).catch(() => null)
    return NextResponse.json({ data: serializePresence(saved, hold) })
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
