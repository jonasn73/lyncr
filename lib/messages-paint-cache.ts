/**
 * Compact Messages thread seed for hard-refresh SSR.
 * Full inbox JSON is too big — keep last message per thread only.
 */

import type { SmsMessage } from "@/lib/types"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"

export const MESSAGES_PAINT_SCOPE = "messages-inbox"
export const MESSAGES_PAINT_COOKIE = paintSeedCookieName(MESSAGES_PAINT_SCOPE)

/** One thread preview — enough for the conversation list. */
export type MessagesPaintRow = {
  id: string
  ph: string
  b: string
  d: "i" | "o"
  t: string
}

export type MessagesPaintSeed = {
  organizationId: string | null
  messages: MessagesPaintRow[]
}

const MAX_PAINT_THREADS = 10

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : d
}

/** Keep newest message per customer phone for the cookie. */
function latestPerThread(messages: SmsMessage[]): SmsMessage[] {
  const byPhone = new Map<string, SmsMessage>()
  for (const msg of messages) {
    const raw = (msg.customer_phone?.trim() || msg.from_number || "").trim()
    if (!raw) continue
    const key = phoneKey(raw) || raw
    const prev = byPhone.get(key)
    if (!prev || new Date(msg.created_at).getTime() >= new Date(prev.created_at).getTime()) {
      byPhone.set(key, msg)
    }
  }
  return [...byPhone.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, MAX_PAINT_THREADS)
}

function trimRow(msg: SmsMessage): MessagesPaintRow {
  const phone = (msg.customer_phone?.trim() || msg.from_number || "").trim()
  const created = new Date(msg.created_at || Date.now())
  const iso = Number.isNaN(created.getTime())
    ? new Date().toISOString()
    : created.toISOString()
  return {
    id: clip(msg.id, 40),
    ph: clip(phone, 18),
    b: clip(msg.body || "", 48),
    d: msg.direction === "outbound" ? "o" : "i",
    // Always full toISOString (24 chars) — clip(28) used to truncate offsets into invalid times.
    t: clip(iso, 24),
  }
}

/** Expand paint rows into SmsMessage stubs for the thread list. */
export function messagesPaintToSms(seed: MessagesPaintSeed): SmsMessage[] {
  return seed.messages.map((row) => {
    const parsed = new Date(row.t)
    const createdAt = Number.isNaN(parsed.getTime())
      ? new Date().toISOString()
      : parsed.toISOString()
    return {
      id: row.id,
      organization_id: seed.organizationId,
      owner_user_id: "",
      phone_number_id: null,
      direction: row.d === "o" ? "outbound" : "inbound",
      from_number: row.d === "i" ? row.ph : "",
      to_number: row.d === "o" ? row.ph : "",
      body: row.b,
      customer_phone: row.ph,
      telnyx_message_id: null,
      status: "received",
      created_at: createdAt,
    }
  })
}

export function writeMessagesPaintSeed(
  messages: SmsMessage[],
  organizationId: string | null = null
): void {
  const latest = latestPerThread(messages)
  let n = Math.min(MAX_PAINT_THREADS, Math.max(0, latest.length))
  while (n >= 0) {
    const payload: MessagesPaintSeed = {
      organizationId,
      messages: latest.slice(0, n).map(trimRow),
    }
    if (writePaintSeedCookie(MESSAGES_PAINT_SCOPE, payload)) return
    n -= 1
  }
}

export function readMessagesPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): MessagesPaintSeed | null {
  const parsed = readPaintSeedCookieValue<MessagesPaintSeed>(cookieRaw)
  if (!parsed || !Array.isArray(parsed.messages)) return null
  return parsed
}

export function readMessagesPaintSeed(
  paint?: MessagesPaintSeed | null,
  organizationId?: string | null
): MessagesPaintSeed | null {
  const fromPaint = paint && Array.isArray(paint.messages) ? paint : null
  const parsed =
    fromPaint ?? readPaintSeedCookie<MessagesPaintSeed>(MESSAGES_PAINT_SCOPE) ?? null
  if (!parsed || !Array.isArray(parsed.messages)) return null
  if (
    organizationId !== undefined &&
    !operationsPaintMatchesOrg(
      { organizationId: parsed.organizationId, calls: [], fetchedAt: 0 },
      organizationId
    )
  ) {
    return null
  }
  return parsed
}

/** Compact signature — skip setState when the live inbox matches the screen. */
export function messagesFingerprint(messages: SmsMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.id}|${m.direction}|${m.customer_phone}|${m.body}|${m.created_at}|${m.status}`
    )
    .join(";")
}

/**
 * Thread-list signature (phones + latest message id/time) — ignores full body text.
 * Lets paint stubs upgrade to the full inbox without a list remount flash when
 * the conversation rows are already the same.
 */
export function messagesThreadListFingerprint(messages: SmsMessage[]): string {
  const byPhone = new Map<string, { id: string; t: number }>()
  for (const msg of messages) {
    const raw = (msg.customer_phone?.trim() || msg.from_number || "").trim()
    if (!raw) continue
    const key = phoneKey(raw) || raw
    const t = new Date(msg.created_at).getTime() || 0
    const prev = byPhone.get(key)
    if (!prev || t >= prev.t) byPhone.set(key, { id: msg.id, t })
  }
  return [...byPhone.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phone, row]) => `${phone}:${row.id}:${row.t}`)
    .join("|")
}
