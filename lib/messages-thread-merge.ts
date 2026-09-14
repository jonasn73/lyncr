/**
 * Merge helpers so Messages can keep painted thread heads while storing the
 * full inbox for the open conversation (stops cookie→session→fetch list flash).
 */

import type { SmsMessage } from "@/lib/types"

function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : d
}

function messagePhone(msg: SmsMessage): string {
  return (msg.customer_phone?.trim() || msg.from_number || "").trim()
}

/** Latest message id per phone key. */
function latestMessageIdByPhone(messages: SmsMessage[]): Map<string, string> {
  const map = new Map<string, { id: string; t: number }>()
  for (const msg of messages) {
    const raw = messagePhone(msg)
    if (!raw) continue
    const key = phoneKey(raw) || raw
    const t = new Date(msg.created_at).getTime() || 0
    const prev = map.get(key)
    if (!prev || t >= prev.t) map.set(key, { id: msg.id, t })
  }
  const out = new Map<string, string>()
  for (const [k, v] of map) out.set(k, v.id)
  return out
}

/**
 * When live fetch is a quiet expansion of painted heads, keep the painted
 * latest-per-thread rows for the list UI. Append only brand-new phones.
 * Full history still lives in `fullInbox` for the open conversation pane.
 */
export function mergePaintedThreadHeads(
  painted: SmsMessage[],
  fullInbox: SmsMessage[]
): SmsMessage[] {
  if (painted.length === 0) return fullInbox
  const paintedLatest = latestMessageIdByPhone(painted)
  const liveLatest = latestMessageIdByPhone(fullInbox)

  // Keep one painted row per existing phone when the latest id still matches.
  const kept: SmsMessage[] = []
  const keptPhones = new Set<string>()
  const byId = new Map(painted.map((m) => [m.id, m]))
  const liveById = new Map(fullInbox.map((m) => [m.id, m]))
  for (const [phone, id] of paintedLatest) {
    const liveId = liveLatest.get(phone)
    if (liveId && liveId === id) {
      const row = byId.get(id)
      if (row) {
        // Keep the painted row's identity (avoids flicker) but pick up a customer_name
        // that resolved server-side after this row was first painted — otherwise a name
        // becoming available would never reach an already-open session (see the same
        // patch in mergeVisibleSmsMessages below).
        const liveRow = liveById.get(id)
        kept.push(
          liveRow?.customer_name && liveRow.customer_name !== row.customer_name
            ? { ...row, customer_name: liveRow.customer_name }
            : row
        )
        keptPhones.add(phone)
      }
    } else if (liveId) {
      // Head changed — take the live latest message as the new list stub.
      const liveRow = fullInbox.find((m) => m.id === liveId)
      if (liveRow) {
        kept.push(liveRow)
        keptPhones.add(phone)
      }
    }
  }

  // Brand-new phones from live inbox (not in paint).
  for (const [phone, id] of liveLatest) {
    if (keptPhones.has(phone)) continue
    const liveRow = fullInbox.find((m) => m.id === id)
    if (liveRow) kept.push(liveRow)
  }

  return kept.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

/** Keep every message object already on screen — stops thread preview/time flicker on fetch. */
export function mergeVisibleSmsMessages(
  visible: SmsMessage[],
  live: SmsMessage[]
): SmsMessage[] {
  if (visible.length === 0) return live
  const visibleIds = new Set(visible.map((m) => m.id))
  const liveById = new Map(live.map((m) => [m.id, m]))
  const merged: SmsMessage[] = []
  for (const msg of visible) {
    const liveMsg = liveById.get(msg.id)
    if (!liveMsg) continue
    // Keep the visible object's identity (avoids body/status/time flicker) but pick up a
    // customer_name that resolved server-side after this message was first cached —
    // otherwise a name becoming available would never reach an already-open session.
    merged.push(
      liveMsg.customer_name && liveMsg.customer_name !== msg.customer_name
        ? { ...msg, customer_name: liveMsg.customer_name }
        : msg
    )
  }
  for (const msg of live) {
    if (!visibleIds.has(msg.id)) merged.push(msg)
  }
  return merged
}

/** Messages for one customer phone from a full inbox (open conversation). */
export function messagesForPhone(
  inbox: SmsMessage[],
  customerPhone: string
): SmsMessage[] {
  const key = phoneKey(customerPhone)
  if (!key && !customerPhone) return []
  return inbox
    .filter((m) => {
      const raw = messagePhone(m)
      if (!raw) return false
      const k = phoneKey(raw) || raw
      return key ? k === key || k.endsWith(key) || key.endsWith(k) : raw === customerPhone
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}
