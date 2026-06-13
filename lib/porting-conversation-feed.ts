// Merge Telnyx porting comments (live API) with local webhook notifications for the owner drawer.

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

/** Chronological thread — Telnyx API comments + webhook inbox, deduped by body + time. */
export function buildPortingConversationFeed(
  notifications: PortingNotification[],
  telnyxComments: TelnyxPortingComment[]
): PortingConversationItem[] {
  const items: PortingConversationItem[] = []

  for (const n of notifications) {
    items.push({
      id: `notif-${n.id}`,
      source: "webhook",
      author: notificationAuthor(n),
      title: n.title,
      body: n.body,
      created_at: n.created_at,
      is_new: n.read_at == null,
    })
  }

  for (const c of telnyxComments) {
    const body = c.body.trim()
    if (!body) continue
    const createdAt = c.created_at || new Date().toISOString()
    const norm = normalizeBody(body)
    const dup = items.some(
      (i) =>
        normalizeBody(i.body) === norm &&
        Math.abs(new Date(i.created_at).getTime() - new Date(createdAt).getTime()) < 120_000
    )
    if (dup) continue
    items.push({
      id: `comment-${c.id}`,
      source: "telnyx_comment",
      author: commentAuthor(c.user_type),
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

  return items.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
}
