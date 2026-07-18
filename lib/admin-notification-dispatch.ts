// Server-side notification filtering for platform admins (granular channel toggles).

import { getUser } from "@/lib/db"
import {
  isOutOfStateLead,
  resolveAdminNotificationPreferences,
} from "@/lib/admin-notification-preferences"
import type { AdminNotificationPreferences, User } from "@/lib/types"
import type { OwnerChannelEvent } from "@/lib/realtime/pusher-server"

export type AdminNotificationDelivery = "noisy" | "silent"

export type PreparedOwnerEvent =
  | { publish: true; payload: Record<string, unknown> }
  | { publish: false }

function ownerEventKind(event: OwnerChannelEvent): "inbound" | "disposition" | "system" | "other" {
  if (event === "call-initiated" || event === "call-answered" || event === "call-completed") return "inbound"
  if (
    event === "job-booked" ||
    event === "disposition-updated" ||
    event === "lead-salvageable" ||
    event === "salvage-recovery-blocked" ||
    event === "job-assigned" ||
    event === "job-status-updated"
  ) {
    return "disposition"
  }
  if (event === "porting-update" || event === "10dlc-update") return "system"
  return "other"
}

export function isSevereOwnerRoutingException(
  event: OwnerChannelEvent,
  payload: Record<string, unknown>
): boolean {
  if (payload.severe === true) return true
  if (event === "porting-update") {
    const status = String(payload.status ?? payload.telnyx_status ?? "").toLowerCase()
    if (status === "rejected" || status === "action_required") return true
  }
  if (event === "10dlc-update") {
    const outcome = String(payload.outcome ?? payload.status ?? "").toLowerCase()
    if (outcome === "rejected") return true
  }
  return false
}

export function withNotificationDeliveryMeta(
  payload: Record<string, unknown>,
  delivery: AdminNotificationDelivery
): Record<string, unknown> {
  return { ...payload, notificationDelivery: delivery }
}

function pushDeliveryForEvent(
  prefs: AdminNotificationPreferences,
  event: OwnerChannelEvent,
  payload: Record<string, unknown>
): AdminNotificationDelivery {
  const kind = ownerEventKind(event)
  if (kind === "inbound") {
    return prefs.push_live_inbound_ringing ? "noisy" : "silent"
  }
  if (kind === "disposition") {
    return prefs.push_operator_dispositions ? "noisy" : "silent"
  }
  if (kind === "system") {
    if (isSevereOwnerRoutingException(event, payload)) {
      return prefs.email_system_fallback_alerts ? "noisy" : "silent"
    }
    return "silent"
  }
  return "silent"
}

/** Apply granular admin prefs to owner-channel Pusher events. */
export async function prepareOwnerEventForDelivery(
  ownerId: string,
  event: OwnerChannelEvent,
  payload: Record<string, unknown>,
  userHint?: User | null
): Promise<PreparedOwnerEvent> {
  const user = userHint ?? (await getUser(ownerId))
  if (!user?.is_platform_admin) {
    return { publish: true, payload }
  }

  const prefs = resolveAdminNotificationPreferences(user)
  const delivery = pushDeliveryForEvent(prefs, event, payload)
  return {
    publish: true,
    payload: withNotificationDeliveryMeta(payload, delivery),
  }
}

/** Gate intake / dispatch SMS for platform admins. */
export function shouldSendAdminLeadSms(params: {
  user: User
  collected: Record<string, unknown>
  ownerHomeState?: string | null
}): boolean {
  if (!params.user.is_platform_admin) return true
  const prefs = resolveAdminNotificationPreferences(params.user)
  const outOfState = isOutOfStateLead({
    collected: params.collected,
    ownerHomeState: params.ownerHomeState,
  })
  return outOfState ? prefs.sms_global_out_of_state_bookings : prefs.sms_local_job_assignments
}

/** Gate operator wrap-up dispatch SMS for platform admins. */
export function shouldSendAdminLocalJobAssignmentSms(user: User): boolean {
  if (!user.is_platform_admin) return true
  return resolveAdminNotificationPreferences(user).sms_local_job_assignments
}

/** Gate daily revenue / talk-time digest emails. */
export function shouldSendAdminDailyDigestEmail(user: User): boolean {
  if (!user.is_platform_admin) return true
  return resolveAdminNotificationPreferences(user).email_daily_revenue_digest
}

/** Gate severe routing / fallback alert emails. */
export function shouldSendAdminSystemFallbackEmail(user: User): boolean {
  if (!user.is_platform_admin) return true
  return resolveAdminNotificationPreferences(user).email_system_fallback_alerts
}
