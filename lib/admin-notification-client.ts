// Client helpers for admin notification Pusher payloads.

import type { AdminNotificationPreferences } from "@/lib/types"

export type AdminNotificationDelivery = "noisy" | "silent"

export function readNotificationDelivery(payload: unknown): AdminNotificationDelivery | null {
  if (!payload || typeof payload !== "object") return null
  const v = (payload as Record<string, unknown>).notificationDelivery
  if (v === "noisy" || v === "silent") return v
  const legacy = (payload as Record<string, unknown>).masterToggleDelivery
  if (legacy === "noisy" || legacy === "severe") return "noisy"
  if (legacy === "silent") return "silent"
  return null
}

export function isNoisyOwnerRealtimePayload(payload: unknown): boolean {
  const delivery = readNotificationDelivery(payload)
  if (!delivery) return true
  return delivery === "noisy"
}

export type PlatformAdminNotificationSession = {
  isPlatformAdmin?: boolean
  adminNotificationPreferences?: AdminNotificationPreferences
}

export function shouldPlayInboundRingAlert(
  session: PlatformAdminNotificationSession | null | undefined
): boolean {
  if (!session?.isPlatformAdmin) return true
  return session.adminNotificationPreferences?.push_live_inbound_ringing !== false
}

export function shouldPlayOperatorDispositionAlert(
  session: PlatformAdminNotificationSession | null | undefined
): boolean {
  if (!session?.isPlatformAdmin) return true
  return session.adminNotificationPreferences?.push_operator_dispositions !== false
}
