// Client helpers for admin notification Pusher payloads.

import type { AdminNotificationPreferences } from "@/lib/types"

export type PlatformAdminNotificationSession = {
  isPlatformAdmin?: boolean
  adminNotificationPreferences?: AdminNotificationPreferences
}

export function shouldPlayOperatorDispositionAlert(
  session: PlatformAdminNotificationSession | null | undefined
): boolean {
  if (!session?.isPlatformAdmin) return true
  return session.adminNotificationPreferences?.push_operator_dispositions !== false
}
