// Account toggle for Missed Call Rescue SMS after unanswered inbound calls.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

const MIGRATION_HINT = "scripts/090-missed-call-textback-enabled.sql"

export function isMissingMissedCallTextbackColumn(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("missed_call_textback_enabled")
}

export { MIGRATION_HINT as MISSED_CALL_TEXTBACK_MIGRATION }

/** Read account flag — defaults true when column missing (legacy always-on). */
export async function getMissedCallTextbackEnabled(ownerUserId: string): Promise<boolean> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT missed_call_textback_enabled FROM users WHERE id = ${ownerUserId} LIMIT 1
    `
    const row = rows[0] as { missed_call_textback_enabled?: boolean } | undefined
    if (!row) return true
    return row.missed_call_textback_enabled !== false
  } catch (e) {
    if (isMissingMissedCallTextbackColumn(e)) return true
    throw e
  }
}

export async function setMissedCallTextbackEnabled(
  ownerUserId: string,
  enabled: boolean
): Promise<void> {
  const sql = sqlClient()
  await sql`
    UPDATE users SET missed_call_textback_enabled = ${enabled === true} WHERE id = ${ownerUserId}
  `
}
