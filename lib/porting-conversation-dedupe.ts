// Deduplicate porting drawer thread items before render (keep newest per unique key).

import {
  formatPortingThreadMessage,
  isPortingRenderableMessage,
} from "@/lib/porting-display"
import type { PortingConversationItem } from "@/lib/types"

/** Stable fingerprint for invalid PIN / passcode rejection duplicates. */
function invalidPinPasscodeKey(normalized: string): boolean {
  return (
    /invalid.*(pin|passcode)/i.test(normalized) ||
    /(pin|passcode).*invalid/i.test(normalized) ||
    /pin\/passcode|passcode\/pin/i.test(normalized) ||
    /rejection due to an invalid pin/i.test(normalized)
  )
}

/** Unique dedupe key — collapses neighboring PIN rejection duplicates to one slot. */
export function portingMessageDedupeKey(body: string): string {
  const formatted = formatPortingThreadMessage(body).trim()
  const normalized = formatted.replace(/\s+/g, " ").toLowerCase()
  if (!normalized) return ""

  if (invalidPinPasscodeKey(normalized)) return "::invalid-pin-passcode::"

  if (/pin|passcode|transfer pin|account pin/i.test(normalized)) {
    return `pin:${normalized.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ")}`
  }

  if (formatted.startsWith("Losing Carrier")) {
    const requirement = normalized.replace(/^losing carrier [^:]+ requiring:\s*/, "")
    return `losing:${requirement}`
  }

  if (formatted.startsWith("System Update:")) return normalized

  return normalized
}

/**
 * Strict pre-render dedupe: one bubble per unique core message, newest timestamp wins.
 * Filters junk-only rows (stray hyphens, punctuation blocks) before mapping.
 */
export function dedupePortingConversationItems(
  items: PortingConversationItem[]
): PortingConversationItem[] {
  const chronological = [...items].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  const renderable = chronological.filter((item) =>
    isPortingRenderableMessage(item.body)
  )

  const latestByKey = new Map<string, PortingConversationItem>()
  for (const item of renderable) {
    const key = portingMessageDedupeKey(item.body)
    if (!key) continue
    const existing = latestByKey.get(key)
    if (!existing || new Date(item.created_at) >= new Date(existing.created_at)) {
      latestByKey.set(key, item)
    }
  }

  const keepIds = new Set([...latestByKey.values()].map((item) => item.id))
  return chronological.filter((item) => keepIds.has(item.id))
}
