// Typed defaults + parsing for platform-admin notification channel toggles.

import type { AdminNotificationPreferences, User } from "@/lib/types"

export const ADMIN_NOTIFICATION_PREFERENCE_KEYS = [
  "sms_local_job_assignments",
  "sms_global_out_of_state_bookings",
  "push_live_inbound_ringing",
  "push_operator_dispositions",
  "email_daily_revenue_digest",
  "email_system_fallback_alerts",
] as const

export type AdminNotificationPreferenceKey = (typeof ADMIN_NOTIFICATION_PREFERENCE_KEYS)[number]

export const DEFAULT_ADMIN_NOTIFICATION_PREFERENCES: AdminNotificationPreferences = {
  sms_local_job_assignments: true,
  sms_global_out_of_state_bookings: true,
  push_live_inbound_ringing: true,
  push_operator_dispositions: true,
  email_daily_revenue_digest: true,
  email_system_fallback_alerts: true,
}

function readBool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === false) return raw
  if (raw === "true") return true
  if (raw === "false") return false
  return fallback
}

/** Merge a DB JSON blob with safe defaults. */
export function parseAdminNotificationPreferences(raw: unknown): AdminNotificationPreferences {
  const base = { ...DEFAULT_ADMIN_NOTIFICATION_PREFERENCES }
  if (!raw || typeof raw !== "object") return base
  const row = raw as Record<string, unknown>
  for (const key of ADMIN_NOTIFICATION_PREFERENCE_KEYS) {
    base[key] = readBool(row[key], base[key])
  }
  return base
}

/** Resolve preferences for a user row (non-admins always get defaults — callers should skip filtering). */
export function resolveAdminNotificationPreferences(
  user: Pick<User, "admin_notification_preferences">
): AdminNotificationPreferences {
  return parseAdminNotificationPreferences(user.admin_notification_preferences)
}

export function isAdminNotificationPreferenceKey(raw: unknown): raw is AdminNotificationPreferenceKey {
  return typeof raw === "string" && (ADMIN_NOTIFICATION_PREFERENCE_KEYS as readonly string[]).includes(raw)
}

/** Infer US state abbreviation from lead/job collected fields. */
export function inferLeadUsState(collected: Record<string, unknown>): string | null {
  const raw =
    collected.job_address_state ??
    collected.state ??
    collected.service_state ??
    collected.job_state ??
    collected.address_state
  if (raw == null) return null
  const s = String(raw).trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(s)) return s
  return null
}

/** True when the lead looks outside the owner's home state (unknown state counts as global). */
export function isOutOfStateLead(params: {
  collected: Record<string, unknown>
  ownerHomeState?: string | null
}): boolean {
  const leadState = inferLeadUsState(params.collected)
  const home = params.ownerHomeState?.trim().toUpperCase() ?? null
  if (!leadState) return true
  if (!home) return false
  return leadState !== home
}
