// Session-scoped cache for notification-center porting alerts — avoids badge pop-in on refresh.

import type { PortingNotificationEnriched, PortingOrder } from "@/lib/types"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type PortingOrderRow = PortingOrder & { unread_notification_count?: number }

/** Cached porting rows + unread alerts for the notification bell badge. */
export type NotificationPortingSnapshot = {
  portingOrders: PortingOrderRow[]
  unreadPortingAlerts: PortingNotificationEnriched[]
}

/** Build the sessionStorage key for a workspace org. */
export function notificationPortingCacheKey(organizationId: string | null): string {
  return persistedCacheKey("notification-porting", organizationId ?? "default")
}

/** Read the last successful porting fetch for this org (if still fresh). */
export function readNotificationPortingCache(
  organizationId: string | null
): NotificationPortingSnapshot | undefined {
  return readPersistedCache<NotificationPortingSnapshot>(notificationPortingCacheKey(organizationId))
}

/** Persist porting state after a successful refresh. */
export function writeNotificationPortingCache(
  organizationId: string | null,
  snapshot: NotificationPortingSnapshot
): void {
  writePersistedCache(notificationPortingCacheKey(organizationId), snapshot)
}
