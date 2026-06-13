// Merge Telnyx porting comments (live API) with local webhook notifications for the owner drawer.

import {
  cleansePortingHumanComment,
  formatPortingThreadMessage,
  isPortingRenderableMessage,
} from "@/lib/porting-display"
import { dedupePortingConversationItems } from "@/lib/porting-conversation-dedupe"
import { isPortingSystemNotificationBody } from "@/lib/porting-notification-log"
import type { PortingConversationItem, PortingNotification } from "@/lib/types"
import type { TelnyxPortingComment } from "@/lib/telnyx-porting-orders"

export type { PortingConversationItem }

function commentAuthor(userType: string): PortingConversationItem["author"] {
  const t = userType.toLowerCase()
  if (t === "admin") return "porting_desk"
  if (t === "user") return "customer"
  if (t === "system") return "system"
  return "carrier"
}

function notificationAuthor(n: PortingNotification): PortingConversationItem["author"] {
  if (n.body.trim().startsWith("Losing Carrier")) return "porting_desk"
  if (isPortingSystemNotificationBody(n.body, n.event_type)) return "system"
  if (n.body.trim().startsWith("System Update:")) return "system"
  const blob = `${n.event_type} ${n.title}`.toLowerCase()
  if (blob.includes("comment")) return "porting_desk"
  if (blob.includes("exception") || blob.includes("action") || blob.includes("reject")) {
    return "porting_desk"
  }
  return "system"
}

function normalizeBody(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Same cleansing rules used when saving webhook comments — keeps dedupe accurate. */
function displayBodyForItem(item: Pick<PortingConversationItem, "body" | "author">): string {
  const raw = item.body.trim()
  if (!raw || !isPortingRenderableMessage(raw)) return ""
  if (raw.startsWith("System Update:") || raw.startsWith("Losing Carrier")) return raw
  if (item.author === "system") return raw
  const cleansed = cleansePortingHumanComment(raw)
  if (cleansed) return cleansed
  return formatPortingThreadMessage(raw)
}

/** Chronological thread — Telnyx API comments + webhook inbox, deduped by cleansed body. */
export function buildPortingConversationFeed(
  notifications: PortingNotification[],
  telnyxComments: TelnyxPortingComment[]
): PortingConversationItem[] {
  const items: PortingConversationItem[] = []

  for (const n of notifications) {
    const author = notificationAuthor(n)
    const body = displayBodyForItem({ body: n.body, author })
    if (!body) continue
    items.push({
      id: `notif-${n.id}`,
      source: "webhook",
      author,
      title: n.title,
      body,
      created_at: n.created_at,
      is_new: n.read_at == null,
    })
  }

  for (const c of telnyxComments) {
    const author = commentAuthor(c.user_type)
    const body = displayBodyForItem({ body: c.body.trim(), author })
    if (!body) continue
    const createdAt = c.created_at || new Date().toISOString()
    const norm = normalizeBody(body)
    const dup = items.some(
      (i) =>
        normalizeBody(displayBodyForItem(i)) === norm &&
        Math.abs(new Date(i.created_at).getTime() - new Date(createdAt).getTime()) < 300_000
    )
    if (dup) continue
    items.push({
      id: `comment-${c.id}`,
      source: "telnyx_comment",
      author,
      title:
        c.user_type.toLowerCase() === "admin"
          ? "Carrier Core Desk"
          : c.user_type.toLowerCase() === "user"
            ? "Your reply"
            : "Carrier update",
      body,
      created_at: createdAt,
      is_new: false,
    })
  }

  const sorted = items.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  return dedupePortingConversationItems(sorted)
}
