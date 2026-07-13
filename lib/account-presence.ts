// Account presence — AVAILABLE / ON_JOB / CLOSED for inbound ring vs SMS capture.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type PresenceStatus = "AVAILABLE" | "ON_JOB" | "CLOSED"

export type AccountPresence = {
  presenceStatus: PresenceStatus
  /** True when the owner manually tapped Closed (cron must not clear it). */
  presenceClosedManual: boolean
}

export const DEFAULT_ACCOUNT_PRESENCE: AccountPresence = {
  presenceStatus: "AVAILABLE",
  presenceClosedManual: false,
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

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingPresenceTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("account_settings") ||
    msg.includes("presence_status") ||
    msg.includes("presence_closed_manual")
  )
}

/** Load presence for an owner (creates a default row when missing). */
export async function getAccountPresence(ownerUserId: string): Promise<AccountPresence> {
  if (!ownerUserId.trim()) return { ...DEFAULT_ACCOUNT_PRESENCE }
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT presence_status, presence_closed_manual
      FROM account_settings
      WHERE user_id = ${ownerUserId}
      LIMIT 1
    `
    const row = rows[0] as
      | { presence_status?: string; presence_closed_manual?: boolean }
      | undefined
    if (!row) {
      await sql`
        INSERT INTO account_settings (user_id, presence_status, presence_closed_manual)
        VALUES (${ownerUserId}, 'AVAILABLE', false)
        ON CONFLICT (user_id) DO NOTHING
      `
      return { ...DEFAULT_ACCOUNT_PRESENCE }
    }
    return {
      presenceStatus: normalizePresenceStatus(row.presence_status),
      presenceClosedManual: row.presence_closed_manual === true,
    }
  } catch (e) {
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
    return { presenceStatus: status, presenceClosedManual: closedManual }
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
    // Fall back to users with active phone lines.
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
