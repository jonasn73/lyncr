// Operator dashboard session heartbeats — gate delayed photo-upload SMS alerts.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function sql() {
  // Neon serverless tagged-template client.
  return neon(resolveNeonDatabaseUrl())
}

/** Consider the dashboard "active" if a heartbeat arrived within this window. */
export const DASHBOARD_ACTIVE_WINDOW_MS = 2 * 60 * 1000

/** Solo locksmith fail-safe: always SMS the operator phone on delayed photo uploads. */
export const PHOTO_UPLOAD_ALERT_ALWAYS_SMS = true

/** Personal device for Lyncr photo-upload SMS alerts (Key Squad). */
export const PHOTO_UPLOAD_ALERT_OPERATOR_E164 = "+15022602716"

/** Upsert last_seen for the signed-in workspace operator. */
export async function touchOperatorDashboardHeartbeat(userId: string): Promise<void> {
  // Ignore empty ids.
  if (!userId.trim()) return
  try {
    // Insert or bump last_seen_at on every heartbeat ping.
    await sql()`
      INSERT INTO operator_dashboard_heartbeats (user_id, last_seen_at, updated_at)
      VALUES (${userId}, now(), now())
      ON CONFLICT (user_id) DO UPDATE
        SET last_seen_at = now(), updated_at = now()
    `
  } catch (e) {
    // Table may be missing until migration 097 — do not break the dashboard.
    console.warn("[dashboard-heartbeat] touch failed:", e)
  }
}

/** True when the operator dashboard was recently open in a browser tab. */
export async function isOperatorDashboardActive(userId: string): Promise<boolean> {
  // Empty id → treat as inactive so SMS fail-safe can fire.
  if (!userId.trim()) return false
  try {
    const rows = await sql()`
      SELECT last_seen_at::text AS last_seen_at
      FROM operator_dashboard_heartbeats
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const raw = (rows[0] as { last_seen_at?: string } | undefined)?.last_seen_at
    if (!raw) return false
    const seen = new Date(raw).getTime()
    if (!Number.isFinite(seen)) return false
    return Date.now() - seen <= DASHBOARD_ACTIVE_WINDOW_MS
  } catch (e) {
    console.warn("[dashboard-heartbeat] active check failed:", e)
    // Fail closed → inactive → SMS still sends via fail-safe path.
    return false
  }
}
