// Detect when the owner (primary dial target) is already on a live answered call.
// Used so Available + on-call does not barge a second PSTN leg onto the same cell.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function getSql() {
  // Neon serverless client — same pattern as other lightweight helpers.
  return neon(resolveNeonDatabaseUrl())
}

/**
 * True when this account already has an answered, not-yet-ended call
 * that looks like the owner (not a receptionist leg) is talking.
 * Excludes the inbound call currently being routed (if known).
 */
export async function hasOwnerOnActiveLiveCall(params: {
  userId: string
  /** Skip this call_control_id / provider_call_sid (the new inbound). */
  excludeCallControlId?: string | null
}): Promise<boolean> {
  // Empty user id → treat as free (fail open so routing still works).
  const userId = String(params.userId || "").trim()
  if (!userId || userId === "00000000-0000-0000-0000-000000000000") return false

  // Optional: do not count the brand-new ringing inbound as “already on a call”.
  const exclude = String(params.excludeCallControlId || "").trim() || null

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT 1 AS hit
      FROM call_logs
      WHERE user_id = ${userId}
        AND ended_at IS NULL
        AND answered_at IS NOT NULL
        AND lower(status) IN ('answered', 'in-progress')
        AND created_at > (now() - interval '2 hours')
        AND (
          routed_to_receptionist_id IS NULL
          OR lower(coalesce(routed_to_name, '')) IN ('owner', 'your phone', 'failsafe')
        )
        AND (
          ${exclude}::text IS NULL
          OR provider_call_sid IS DISTINCT FROM ${exclude}
        )
      LIMIT 1
    `
    // Any row means the owner's cell (or owner-labeled leg) is live.
    return Boolean(rows[0])
  } catch (e) {
    // Missing columns / table → fail open (do not block Available ringing).
    console.warn("[owner-live-call] lookup skipped:", e)
    return false
  }
}

/** Invite / SMS sources that came from Busy hold or press-1. */
export function isHoldPress1BookingSource(source?: string | null): boolean {
  const s = String(source || "")
    .trim()
    .toLowerCase()
  if (!s) return false
  return (
    s === "cc_busy_press1" ||
    s === "cc_busy_hold_press1" ||
    s === "cc_busy_hold_max_wait" ||
    s === "cc_busy_hold_leave" ||
    s === "cc_busy_hold_cap" ||
    s === "cc_busy_gather_fail" ||
    s === "cc_on_call_press1" ||
    s.startsWith("cc_busy_hold") ||
    s.includes("hold_press") ||
    s.includes("busy_press1")
  )
}
