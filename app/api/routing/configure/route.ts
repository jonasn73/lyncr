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
  defaultIvrVoiceEngineModel,
  elevenLabsKeyConfigured,
  IVR_VOICE_PERSONA_OPTIONS,
} from "@/lib/ivr-automation-settings"
import {
  getAccountHoldSettings,
  setAccountHoldSettings,
} from "@/lib/call-queue-db"
import { holdMaxWaitSecs, holdRePromptIntervalMs } from "@/lib/hold-queue"

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
  fallbackType: string,
  hold?: Awaited<ReturnType<typeof getAccountHoldSettings>> | null
) {
  const holdMusicUrl = hold?.holdMusicUrl ?? null
  const maxWaitDefault = holdMaxWaitSecs()
  const repromptDefault = Math.round(holdRePromptIntervalMs() / 1000)
  return {
    activeRoutingMode: modeState.activeRoutingMode,
    customRoutingPhone: modeState.customRoutingPhone,
    ringTimeoutSeconds: modeState.ringTimeoutSeconds,
    selectedReceptionistId: modeState.selectedReceptionistId,
    fallbackType,
    onJobGreetingText: presence.onJobGreetingText,
    closedGreetingText: presence.closedGreetingText,
    ivrBypassCode: presence.ivrBypassCode,
    ivrVoiceEngineModel: presence.ivrVoiceEngineModel,
    holidayOverrideStart: presence.holidayOverrideStart,
    holidayOverrideEnd: presence.holidayOverrideEnd,
    holidayGreetingText: presence.holidayGreetingText,
    holdMusicUrl,
    hold_music_url: holdMusicUrl,
    holdMaxWaitSecs: hold?.holdMaxWaitSecs ?? null,
    hold_max_wait_secs: hold?.holdMaxWaitSecs ?? null,
    holdRepromptSecs: hold?.holdRepromptSecs ?? null,
    hold_reprompt_secs: hold?.holdRepromptSecs ?? null,
    holdDefaults: {
      maxWaitSecs: maxWaitDefault,
      repromptSecs: repromptDefault,
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

  const numberParam = req.nextUrl.searchParams.get("number")?.trim() || null
  const businessNumber = numberParam ? normalizePhoneNumberE164(numberParam) : null

  try {
    const [modeState, presence, routing, hold] = await Promise.all([
      getActiveRoutingState(userId, businessNumber),
      getAccountPresence(userId),
      businessNumber
        ? getRoutingConfigForNumber(userId, businessNumber)
        : getRoutingConfig(userId),
      getAccountHoldSettings(userId).catch(() => null),
    ])
    return NextResponse.json({
      data: serializeConfigure(modeState, presence, routing?.fallback_type || "owner", hold),
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

  const receptionistIdRaw =
    typeof body.selected_receptionist_id === "string"
      ? body.selected_receptionist_id
      : typeof body.selectedReceptionistId === "string"
        ? body.selectedReceptionistId
        : null

  const fallbackRaw = String(body.fallback_type ?? body.fallbackType ?? "").toLowerCase()
  // Map hold_queue alias → hold (Advanced Rules missed-call → soft hold).
  const fallbackNormalized = fallbackRaw === "hold_queue" ? "hold" : fallbackRaw
  const fallbackType =
    fallbackNormalized === "ai" ||
    fallbackNormalized === "voicemail" ||
    fallbackNormalized === "owner" ||
    fallbackNormalized === "hold"
      ? (fallbackNormalized as "ai" | "voicemail" | "owner" | "hold")
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
    const holdMusicRaw = pickNullableString(body, ["holdMusicUrl", "hold_music_url"])
    const holdMaxWaitRaw = body.holdMaxWaitSecs ?? body.hold_max_wait_secs
    const holdRepromptRaw = body.holdRepromptSecs ?? body.hold_reprompt_secs

    // One request commits mode + greetings/security + classic fallback together.
    const [modeSaved, presenceSaved] = await Promise.all([
      applyActiveRoutingMode({
        ownerUserId: userId,
        businessNumber,
        mode,
        customRoutingPhone: customPhone,
        ringTimeoutSeconds: ringTimeout,
        selectedReceptionistId: mode === "team_receptionist" ? receptionistIdRaw : null,
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

    // Fallback + ring timeout only — receptionist id already set by applyActiveRoutingMode.
    await updateRoutingConfig(
      userId,
      {
        ...(fallbackType ? { fallback_type: fallbackType } : {}),
        ...((mode === "your_phone" || mode === "team_receptionist") &&
        typeof ringTimeout === "number"
          ? { ring_timeout_seconds: ringTimeout }
          : {}),
      },
      businessNumber
    )

    const [routing, hold] = await Promise.all([
      businessNumber
        ? getRoutingConfigForNumber(userId, businessNumber)
        : getRoutingConfig(userId),
      getAccountHoldSettings(userId).catch(() => null),
    ])

    return NextResponse.json({
      data: serializeConfigure(
        modeSaved,
        presenceSaved,
        routing?.fallback_type || fallbackType || "owner",
        hold
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
