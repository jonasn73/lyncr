// ============================================
// Telnyx Voice AI — provision + sync (shared server logic)
// ============================================
// Used by /api/ai-assistant and /api/routing so choosing "AI fallback" can auto-create the assistant.

import {
  getUser,
  getRoutingConfig,
  updateUser,
  getAiIntakeConfigRaw,
  upsertAiIntakeConfig,
  updateRoutingConfig,
} from "@/lib/db"
import {
  normalizeIntakeConfig,
  buildFullTelnyxInstructions,
  resolveTelnyxAssistantGreeting,
} from "@/lib/ai-intake-defaults"
import { isAiIntakeProfileId } from "@/lib/business-industries"
import {
  telnyxCreateAssistant,
  telnyxUpdateAssistant,
  type UpdateTelnyxAssistantParams,
  resolveAssistantModel,
  resolveAssistantVoice,
  buildVoiceSettingsForAssistant,
} from "@/lib/telnyx-voice-ai-api"

const DEFAULT_BUSINESS_HOURS = "Monday through Friday, 9 AM to 5 PM. Closed weekends."

/** Merge saved intake JSON with an incoming PATCH / POST body (same rules as the API route). */
export function mergeIntakeConfigForAi(
  prev: Record<string, unknown> | null,
  incoming: Record<string, unknown> | undefined,
  greeting: string | undefined
): Record<string, unknown> {
  const base = { ...(prev || {}), ...(incoming || {}) }
  const g = greeting?.trim()
  if (g && !(typeof base.busyGreeting === "string" && base.busyGreeting.trim())) {
    base.busyGreeting = g
  }
  if (incoming?.followIndustryForAi === true) {
    delete base.profileId
  }
  delete base.followIndustryForAi
  if (typeof base.profileId === "string" && !isAiIntakeProfileId(base.profileId)) {
    delete base.profileId
  }
  const clearable = ["telnyxModel", "telnyxVoice", "extraAiInstructions"] as const
  for (const key of clearable) {
    if (incoming && key in incoming && incoming[key] === "") {
      delete base[key]
    }
  }
  return base
}

export type EnsureTelnyxVoiceAiResult = {
  linked: boolean
  provisioned: boolean
  assistantId: string | null
  error?: string
}

/** Push latest intake + greeting (+ optional model/voice) to Telnyx for the linked assistant. */
export async function syncTelnyxAssistantFromIntake(userId: string): Promise<void> {
  const u = await getUser(userId)
  const aid = u?.telnyx_ai_assistant_id?.trim()
  if (!u || !aid) return
  const raw = await getAiIntakeConfigRaw(userId)
  const cfg = normalizeIntakeConfig(raw, { userIndustry: u.industry })
  const instructions = buildFullTelnyxInstructions(u.business_name, u.phone, DEFAULT_BUSINESS_HOURS, cfg)
  const greeting = resolveTelnyxAssistantGreeting(cfg)
  const updates: UpdateTelnyxAssistantParams = { instructions, greeting }
  if (cfg.telnyxModel?.trim()) updates.model = cfg.telnyxModel.trim()
  updates.voice_settings = buildVoiceSettingsForAssistant(resolveAssistantVoice(cfg.telnyxVoice))
  await telnyxUpdateAssistant(aid, updates)
}

/** True when Telnyx says the assistant id no longer exists (stale DB link). */
function isAssistantNotFoundError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("10005") ||
    msg.includes("resource not found")
  )
}

export type SyncTelnyxAssistantFromIntakeResult = {
  /** Null when sync succeeded. */
  error: string | null
  /** True when we cleared a missing id and created a new Telnyx assistant. */
  recreatedAssistant: boolean
}

/**
 * Push intake to Telnyx. If the stored assistant id returns 404, clear it and create a new assistant
 * when routing fallback is `ai`, then sync again.
 */
export async function syncTelnyxAssistantFromIntakeOrRecover(userId: string): Promise<SyncTelnyxAssistantFromIntakeResult> {
  try {
    await syncTelnyxAssistantFromIntake(userId)
    return { error: null, recreatedAssistant: false }
  } catch (e) {
    if (!isAssistantNotFoundError(e)) {
      return {
        error: e instanceof Error && e.message.trim() ? e.message.trim() : "Telnyx rejected the assistant update.",
        recreatedAssistant: false,
      }
    }
    await updateUser(userId, { telnyx_ai_assistant_id: null })
    const rc = await getRoutingConfig(userId)
    if (rc?.fallback_type !== "ai") {
      return {
        error:
          "The Voice AI assistant saved in Zing no longer exists in Telnyx (404). Turn on AI fallback in Routing again, or paste a valid assistant id under Support.",
        recreatedAssistant: false,
      }
    }
    const ensured = await ensureTelnyxVoiceAiAssistant(userId, { skipEnvAssistantFallback: true })
    if (!ensured.linked || !ensured.assistantId) {
      return {
        error: ensured.error || "Could not create a replacement Telnyx assistant.",
        recreatedAssistant: false,
      }
    }
    try {
      await syncTelnyxAssistantFromIntake(userId)
      return { error: null, recreatedAssistant: true }
    } catch (e2) {
      return {
        error: e2 instanceof Error && e2.message.trim() ? e2.message.trim() : String(e2),
        recreatedAssistant: true,
      }
    }
  }
}

export type EnsureTelnyxVoiceAiOptions = {
  intake?: Record<string, unknown>
  greeting?: string
  telnyxAiAssistantId?: string
  /**
   * When true, Telnyx create failure will **not** fall back to `TELNYX_AI_ASSISTANT_ID` env.
   * Used after we detect a stale assistant (404) so we never re-link the same dead id.
   */
  skipEnvAssistantFallback?: boolean
}

/**
 * If the user has no Telnyx assistant id, create one (or link manual id / env fallback).
 * When already linked, returns immediately without changing Telnyx.
 */
export async function ensureTelnyxVoiceAiAssistant(
  userId: string,
  opts?: EnsureTelnyxVoiceAiOptions
): Promise<EnsureTelnyxVoiceAiResult> {
  const user = await getUser(userId)
  if (!user) {
    return { linked: false, provisioned: false, assistantId: null, error: "User not found" }
  }

  if (user.telnyx_ai_assistant_id?.trim()) {
    return { linked: true, provisioned: false, assistantId: user.telnyx_ai_assistant_id }
  }

  const manual = opts?.telnyxAiAssistantId?.trim()
  if (manual) {
    await updateUser(userId, { telnyx_ai_assistant_id: manual })
    return { linked: true, provisioned: false, assistantId: manual }
  }

  const fromEnv = process.env.TELNYX_AI_ASSISTANT_ID?.trim() || ""
  const prevIntake = await getAiIntakeConfigRaw(userId)
  const config = await getRoutingConfig(userId)
  const mergeGreeting = opts?.greeting?.trim() || config?.ai_greeting?.trim() || undefined
  const merged = mergeIntakeConfigForAi(prevIntake, opts?.intake, mergeGreeting)
  await upsertAiIntakeConfig(userId, merged)

  const greetingLine =
    opts?.greeting?.trim() ||
    config?.ai_greeting?.trim() ||
    `Thank you for calling ${user.business_name}. No one is available right now, but I'd be happy to help. How can I assist you?`

  if (opts?.greeting?.trim()) {
    await updateRoutingConfig(userId, { ai_greeting: opts.greeting.trim() }, null)
  } else if (greetingLine && !config?.ai_greeting?.trim()) {
    await updateRoutingConfig(userId, { ai_greeting: greetingLine }, null)
  }

  const intakeCfg = normalizeIntakeConfig(merged, { userIndustry: user.industry })
  const telnyxGreeting = resolveTelnyxAssistantGreeting(intakeCfg)
  const instructions = buildFullTelnyxInstructions(
    user.business_name,
    user.phone,
    DEFAULT_BUSINESS_HOURS,
    intakeCfg
  )

  let assistantId: string
  let provisioned = false

  try {
    const created = await telnyxCreateAssistant({
      name: `Zing — ${user.business_name}`.slice(0, 120),
      instructions,
      greeting: telnyxGreeting,
      model: resolveAssistantModel(intakeCfg.telnyxModel),
      voice: resolveAssistantVoice(intakeCfg.telnyxVoice),
    })
    assistantId = created.id
    provisioned = true
  } catch (e) {
    const allowEnv = Boolean(fromEnv) && opts?.skipEnvAssistantFallback !== true
    if (allowEnv) {
      assistantId = fromEnv
      console.error("[ensureTelnyxVoiceAiAssistant] Telnyx create failed, using TELNYX_AI_ASSISTANT_ID:", e)
    } else {
      const msg = e instanceof Error ? e.message : "Failed to create Telnyx assistant"
      return { linked: false, provisioned: false, assistantId: null, error: msg }
    }
  }

  await updateUser(userId, { telnyx_ai_assistant_id: assistantId })
  return { linked: true, provisioned, assistantId }
}
