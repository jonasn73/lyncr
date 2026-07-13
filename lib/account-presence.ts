// Account presence — AVAILABLE / ON_JOB / CLOSED for inbound ring vs SMS capture.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  DEFAULT_CLOSED_GREETING_TEXT,
  DEFAULT_IVR_VOICE_ENGINE_MODEL,
  DEFAULT_ON_JOB_GREETING_TEXT,
  normalizeIvrBypassCode,
  parseHolidayDateTimeInput,
} from "@/lib/ivr-automation-settings"

export type PresenceStatus = "AVAILABLE" | "ON_JOB" | "CLOSED"

export type AccountPresence = {
  presenceStatus: PresenceStatus
  /** True when the owner manually tapped Closed (cron must not clear it). */
  presenceClosedManual: boolean
  /** Custom TeXML Speak when ON_JOB (falls back to product default). */
  onJobGreetingText: string
  /** Custom TeXML Speak when CLOSED (falls back to product default). */
  closedGreetingText: string
  /** Secret DTMF bypass (null = disabled). */
  ivrBypassCode: string | null
  /** TTS persona / engine model id for <Say voice>. */
  ivrVoiceEngineModel: string
  /** Holiday override window start (ISO) or null. */
  holidayOverrideStart: string | null
  /** Holiday override window end (ISO) or null. */
  holidayOverrideEnd: string | null
  /** Spoken when inside the holiday window. */
  holidayGreetingText: string | null
}

export { DEFAULT_ON_JOB_GREETING_TEXT, DEFAULT_CLOSED_GREETING_TEXT }

export const DEFAULT_ACCOUNT_PRESENCE: AccountPresence = {
  presenceStatus: "AVAILABLE",
  presenceClosedManual: false,
  onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
  closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
  ivrBypassCode: null,
  ivrVoiceEngineModel: DEFAULT_IVR_VOICE_ENGINE_MODEL,
  holidayOverrideStart: null,
  holidayOverrideEnd: null,
  holidayGreetingText: null,
}

export function normalizePresenceStatus(raw: unknown): PresenceStatus {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_")
  if (v === "ON_JOB" || v === "ONJOB" || v === "BUSY") return "ON_JOB"
  if (v === "CLOSED" || v === "OFF" || v === "OFF_DUTY") return "CLOSED"
  return "AVAILABLE"
}

/** Prefer trimmed custom copy; otherwise the product default for that presence. */
export function resolvePresenceAutomationGreeting(params: {
  presenceStatus: PresenceStatus | string | null | undefined
  onJobGreetingText?: string | null
  closedGreetingText?: string | null
}): string {
  const status = normalizePresenceStatus(params.presenceStatus)
  if (status === "ON_JOB") {
    const custom =
      typeof params.onJobGreetingText === "string" ? params.onJobGreetingText.trim() : ""
    return custom || DEFAULT_ON_JOB_GREETING_TEXT
  }
  if (status === "CLOSED") {
    const custom =
      typeof params.closedGreetingText === "string" ? params.closedGreetingText.trim() : ""
    return custom || DEFAULT_CLOSED_GREETING_TEXT
  }
  return DEFAULT_ON_JOB_GREETING_TEXT
}

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingPresenceTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("account_settings") ||
    msg.includes("presence_status") ||
    msg.includes("presence_closed_manual") ||
    msg.includes("on_job_greeting_text") ||
    msg.includes("closed_greeting_text") ||
    msg.includes("ivr_bypass_code") ||
    msg.includes("ivr_voice_engine_model") ||
    msg.includes("holiday_override")
  )
}

function isMissingGreetingColumns(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("on_job_greeting_text") || msg.includes("closed_greeting_text")
}

function isMissingDispatchColumns(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("ivr_bypass_code") ||
    msg.includes("ivr_voice_engine_model") ||
    msg.includes("holiday_override_start") ||
    msg.includes("holiday_override_end") ||
    msg.includes("holiday_greeting_text")
  )
}

function normalizeGreetingText(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim()
  return fallback
}

function isoOrNull(raw: unknown): string | null {
  if (raw == null) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString()
  const s = String(raw).trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

type PresenceRow = {
  presence_status?: string
  presence_closed_manual?: boolean
  on_job_greeting_text?: string | null
  closed_greeting_text?: string | null
  ivr_bypass_code?: string | null
  ivr_voice_engine_model?: string | null
  holiday_override_start?: string | Date | null
  holiday_override_end?: string | Date | null
  holiday_greeting_text?: string | null
}

function mapPresenceRow(row: PresenceRow): AccountPresence {
  return {
    presenceStatus: normalizePresenceStatus(row.presence_status),
    presenceClosedManual: row.presence_closed_manual === true,
    onJobGreetingText: normalizeGreetingText(row.on_job_greeting_text, DEFAULT_ON_JOB_GREETING_TEXT),
    closedGreetingText: normalizeGreetingText(row.closed_greeting_text, DEFAULT_CLOSED_GREETING_TEXT),
    ivrBypassCode: normalizeIvrBypassCode(row.ivr_bypass_code),
    ivrVoiceEngineModel:
      typeof row.ivr_voice_engine_model === "string" && row.ivr_voice_engine_model.trim()
        ? row.ivr_voice_engine_model.trim()
        : DEFAULT_IVR_VOICE_ENGINE_MODEL,
    holidayOverrideStart: isoOrNull(row.holiday_override_start),
    holidayOverrideEnd: isoOrNull(row.holiday_override_end),
    holidayGreetingText:
      typeof row.holiday_greeting_text === "string" && row.holiday_greeting_text.trim()
        ? row.holiday_greeting_text.trim()
        : null,
  }
}

/** Load presence for an owner (creates a default row when missing). */
export async function getAccountPresence(ownerUserId: string): Promise<AccountPresence> {
  if (!ownerUserId.trim()) return { ...DEFAULT_ACCOUNT_PRESENCE }
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        presence_status,
        presence_closed_manual,
        on_job_greeting_text,
        closed_greeting_text,
        ivr_bypass_code,
        ivr_voice_engine_model,
        holiday_override_start,
        holiday_override_end,
        holiday_greeting_text
      FROM account_settings
      WHERE user_id = ${ownerUserId}
      LIMIT 1
    `
    const row = rows[0] as PresenceRow | undefined
    if (!row) {
      await sql`
        INSERT INTO account_settings (user_id, presence_status, presence_closed_manual)
        VALUES (${ownerUserId}, 'AVAILABLE', false)
        ON CONFLICT (user_id) DO NOTHING
      `
      return { ...DEFAULT_ACCOUNT_PRESENCE }
    }
    return mapPresenceRow(row)
  } catch (e) {
    // Pre-101: greetings exist but dispatch columns do not.
    if (isMissingDispatchColumns(e) && !isMissingGreetingColumns(e)) {
      try {
        const rows = await sql`
          SELECT presence_status, presence_closed_manual, on_job_greeting_text, closed_greeting_text
          FROM account_settings
          WHERE user_id = ${ownerUserId}
          LIMIT 1
        `
        const row = rows[0] as PresenceRow | undefined
        if (!row) return { ...DEFAULT_ACCOUNT_PRESENCE }
        return {
          ...DEFAULT_ACCOUNT_PRESENCE,
          ...mapPresenceRow({
            ...row,
            ivr_bypass_code: null,
            ivr_voice_engine_model: DEFAULT_IVR_VOICE_ENGINE_MODEL,
            holiday_override_start: null,
            holiday_override_end: null,
            holiday_greeting_text: null,
          }),
        }
      } catch {
        return { ...DEFAULT_ACCOUNT_PRESENCE }
      }
    }
    // Pre-100 migration: presence exists but greeting columns do not.
    if (isMissingGreetingColumns(e)) {
      try {
        const rows = await sql`
          SELECT presence_status, presence_closed_manual
          FROM account_settings
          WHERE user_id = ${ownerUserId}
          LIMIT 1
        `
        const row = rows[0] as PresenceRow | undefined
        if (!row) return { ...DEFAULT_ACCOUNT_PRESENCE }
        return {
          ...DEFAULT_ACCOUNT_PRESENCE,
          presenceStatus: normalizePresenceStatus(row.presence_status),
          presenceClosedManual: row.presence_closed_manual === true,
        }
      } catch {
        return { ...DEFAULT_ACCOUNT_PRESENCE }
      }
    }
    if (isMissingPresenceTable(e)) {
      console.warn("[presence] table missing — run scripts/092-account-presence-status.sql")
      return { ...DEFAULT_ACCOUNT_PRESENCE }
    }
    throw e
  }
}

/**
 * Owner dashboard toggle.
 * CLOSED → locks manual closed flag; Available / On-Job clears the lock.
 */
export async function setAccountPresence(params: {
  ownerUserId: string
  presenceStatus: PresenceStatus
}): Promise<AccountPresence> {
  const status = normalizePresenceStatus(params.presenceStatus)
  const closedManual = status === "CLOSED"
  const sql = sqlClient()
  try {
    await sql`
      INSERT INTO account_settings (user_id, presence_status, presence_closed_manual, updated_at)
      VALUES (${params.ownerUserId}, ${status}, ${closedManual}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        presence_status = EXCLUDED.presence_status,
        presence_closed_manual = EXCLUDED.presence_closed_manual,
        updated_at = now()
    `
    return getAccountPresence(params.ownerUserId)
  } catch (e) {
    if (isMissingPresenceTable(e)) {
      const err = new Error(
        "Presence settings missing — run scripts/092-account-presence-status.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "PRESENCE_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}

export type PresenceGreetingsUpdate = {
  ownerUserId: string
  onJobGreetingText: string
  closedGreetingText: string
  ivrBypassCode?: string | null
  ivrVoiceEngineModel?: string | null
  holidayOverrideStart?: string | null
  holidayOverrideEnd?: string | null
  holidayGreetingText?: string | null
}

/** Save Automation Voice Greetings + dispatch fields from the dashboard. */
export async function setAccountPresenceGreetings(
  params: PresenceGreetingsUpdate
): Promise<AccountPresence> {
  const onJob = params.onJobGreetingText.trim() || DEFAULT_ON_JOB_GREETING_TEXT
  const closed = params.closedGreetingText.trim() || DEFAULT_CLOSED_GREETING_TEXT
  const bypass = normalizeIvrBypassCode(params.ivrBypassCode)
  const voice =
    typeof params.ivrVoiceEngineModel === "string" && params.ivrVoiceEngineModel.trim()
      ? params.ivrVoiceEngineModel.trim()
      : DEFAULT_IVR_VOICE_ENGINE_MODEL
  const holidayStart = parseHolidayDateTimeInput(params.holidayOverrideStart)
  const holidayEnd = parseHolidayDateTimeInput(params.holidayOverrideEnd)
  const holidayText =
    typeof params.holidayGreetingText === "string" && params.holidayGreetingText.trim()
      ? params.holidayGreetingText.trim()
      : null

  const sql = sqlClient()
  try {
    await sql`
      INSERT INTO account_settings (
        user_id, presence_status, presence_closed_manual,
        on_job_greeting_text, closed_greeting_text,
        ivr_bypass_code, ivr_voice_engine_model,
        holiday_override_start, holiday_override_end, holiday_greeting_text,
        updated_at
      )
      VALUES (
        ${params.ownerUserId}, 'AVAILABLE', false,
        ${onJob}, ${closed},
        ${bypass}, ${voice},
        ${holidayStart}, ${holidayEnd}, ${holidayText},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        on_job_greeting_text = EXCLUDED.on_job_greeting_text,
        closed_greeting_text = EXCLUDED.closed_greeting_text,
        ivr_bypass_code = EXCLUDED.ivr_bypass_code,
        ivr_voice_engine_model = EXCLUDED.ivr_voice_engine_model,
        holiday_override_start = EXCLUDED.holiday_override_start,
        holiday_override_end = EXCLUDED.holiday_override_end,
        holiday_greeting_text = EXCLUDED.holiday_greeting_text,
        updated_at = now()
    `
    return getAccountPresence(params.ownerUserId)
  } catch (e) {
    if (isMissingDispatchColumns(e)) {
      const err = new Error(
        "Dispatch columns missing — run scripts/101-ivr-automation-dispatch.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "IVR_DISPATCH_MIGRATION_REQUIRED"
      throw err
    }
    if (isMissingGreetingColumns(e) || isMissingPresenceTable(e)) {
      const err = new Error(
        "Presence greeting columns missing — run scripts/100-presence-automation-greetings.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "PRESENCE_GREETINGS_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}

/**
 * Calendar cron write — never clears a manually locked CLOSED.
 * Returns whether a row was updated.
 */
export async function applyCalendarPresenceAutomation(params: {
  ownerUserId: string
  currentlyInBlockout: boolean
}): Promise<{ updated: boolean; presenceStatus: PresenceStatus; skippedClosedManual?: boolean }> {
  const sql = sqlClient()
  try {
    const current = await getAccountPresence(params.ownerUserId)
    if (current.presenceStatus === "CLOSED" && current.presenceClosedManual) {
      return {
        updated: false,
        presenceStatus: "CLOSED",
        skippedClosedManual: true,
      }
    }

    const next: PresenceStatus = params.currentlyInBlockout ? "ON_JOB" : "AVAILABLE"
    if (current.presenceStatus === next && !current.presenceClosedManual) {
      return { updated: false, presenceStatus: next }
    }

    await sql`
      INSERT INTO account_settings (user_id, presence_status, presence_closed_manual, updated_at)
      VALUES (${params.ownerUserId}, ${next}, false, now())
      ON CONFLICT (user_id) DO UPDATE SET
        presence_status = EXCLUDED.presence_status,
        presence_closed_manual = false,
        updated_at = now()
      WHERE account_settings.presence_closed_manual IS NOT TRUE
         OR account_settings.presence_status IS DISTINCT FROM 'CLOSED'
    `
    return { updated: true, presenceStatus: next }
  } catch (e) {
    if (isMissingPresenceTable(e)) {
      return { updated: false, presenceStatus: "AVAILABLE" }
    }
    throw e
  }
}

/** All owners with an account_settings row (for cron). */
export async function listOwnersForPresenceCron(): Promise<string[]> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT user_id FROM account_settings
    `
    return (rows as { user_id: string }[]).map((r) => String(r.user_id))
  } catch (e) {
    if (isMissingPresenceTable(e)) return []
    try {
      const rows = await sql`
        SELECT DISTINCT user_id FROM phone_numbers WHERE status = 'active'
      `
      return (rows as { user_id: string }[]).map((r) => String(r.user_id))
    } catch {
      return []
    }
  }
}
