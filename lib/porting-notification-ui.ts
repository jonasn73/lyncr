// Client-safe helpers for porting webhook notification UI.

import type { PortingNotification } from "@/lib/types"

/** True when Telnyx webhook event likely needs owner attention (comment, exception, action). */
export function isPortingNotificationActionNeeded(eventType: string, title?: string): boolean {
  const blob = `${eventType} ${title ?? ""}`.toLowerCase()
  return (
    blob.includes("comment") ||
    blob.includes("exception") ||
    blob.includes("action") ||
    blob.includes("rejected") ||
    blob.includes("failed")
  )
}

export function countUnreadForOrder(notifications: PortingNotification[]): number {
  return notifications.filter((n) => n.read_at == null).length
}

export function latestActionNeededNotification(
  notifications: PortingNotification[]
): PortingNotification | null {
  return (
    notifications.find(
      (n) => n.read_at == null && isPortingNotificationActionNeeded(n.event_type, n.title)
    ) ?? null
  )
}

/** Order-level carrier flags that should prompt the user to open Messages. */
export function orderNeedsPortingAttention(telnyxStatus: string | null | undefined): boolean {
  const ts = (telnyxStatus ?? "").toLowerCase()
  return ts.includes("exception") || ts.includes("action") || ts.includes("rejected")
}
