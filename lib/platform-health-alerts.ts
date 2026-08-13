// Decide when to text/email platform admins about Neon / Telnyx going red or recovering.

import type { LyncrAdminHealthStatus } from "@/lib/types"

/** One health probe name — matches /api/admin/metrics. */
export type PlatformHealthCheckName = "neon" | "telnyx"

/** Status strings used in snapshots + SMS copy. */
export type PlatformHealthStatus = LyncrAdminHealthStatus

/** What the cron should do after comparing this tick to the last snapshot. */
export type PlatformHealthAlertAction = "alert_down" | "alert_up" | "none"

/** Default: do not SMS every 5-minute cron tick. */
export const PLATFORM_HEALTH_ALERT_COOLDOWN_MS = 20 * 60 * 1000

/** Last known row from `platform_health_snapshots` (null fields = never seen). */
export type PlatformHealthSnapshotLike = {
  status: PlatformHealthStatus | null
  last_alerted_at: string | Date | null
  last_recovery_alerted_at: string | Date | null
}

/** True when this status should page on-call (unconfigured Telnyx is not "red"). */
export function isPlatformHealthRed(status: PlatformHealthStatus | null | undefined): boolean {
  // Only hard failures page. Missing API key is ops setup, not an outage flip.
  return status === "error"
}

/** Compare this tick vs last snapshot and decide SMS/email. */
export function decidePlatformHealthAlert(params: {
  currentStatus: PlatformHealthStatus
  previous: PlatformHealthSnapshotLike | null
  now?: Date
  cooldownMs?: number
}): { action: PlatformHealthAlertAction; reason: string } {
  // Clock used for cooldown math (injectable in tests).
  const now = params.now ?? new Date()
  // 20 minutes unless a test passes a smaller window.
  const cooldownMs = params.cooldownMs ?? PLATFORM_HEALTH_ALERT_COOLDOWN_MS
  // Current probe result for this check (neon or telnyx).
  const currentRed = isPlatformHealthRed(params.currentStatus)
  // Last stored status — null on the very first cron tick.
  const previousStatus = params.previous?.status ?? null
  const previousRed = isPlatformHealthRed(previousStatus)

  // Recovery: was red, now healthy (ok or unconfigured after a real error).
  if (!currentRed && previousRed) {
    return { action: "alert_up", reason: "recovered" }
  }

  // Still healthy (or still unconfigured) — stay quiet.
  if (!currentRed) {
    return { action: "none", reason: "healthy" }
  }

  // First time we ever see this check, and it is already red — page once.
  if (!params.previous || previousStatus == null) {
    return { action: "alert_down", reason: "first_error" }
  }

  // Fresh flip to red.
  if (!previousRed) {
    return { action: "alert_down", reason: "flipped_to_error" }
  }

  // Still red: only remind after the cooldown so cron ticks do not spam SMS.
  const lastAlertedAt = parseOptionalDate(params.previous.last_alerted_at)
  if (!lastAlertedAt) {
    return { action: "alert_down", reason: "error_never_alerted" }
  }
  const elapsed = now.getTime() - lastAlertedAt.getTime()
  if (elapsed >= cooldownMs) {
    return { action: "alert_down", reason: "error_cooldown_elapsed" }
  }
  return { action: "none", reason: "error_within_cooldown" }
}

/** Human SMS / email body — no customer PII, no auto-fix language. */
export function formatPlatformHealthAlertMessage(params: {
  checkName: PlatformHealthCheckName
  action: Exclude<PlatformHealthAlertAction, "none">
  status: PlatformHealthStatus
}): string {
  // Plain shop English for the platform owner's phone.
  const label = params.checkName === "neon" ? "Neon (database)" : "Telnyx (phone)"
  if (params.action === "alert_up") {
    return `Lyncr health: ${label} is OK again.`
  }
  return `Lyncr health: ${label} is down (${params.status}). Check /admin. No customer shops were texted.`
}

/** Parse a DB timestamp that may already be a Date. */
function parseOptionalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
