/**
 * Compact Messages thread seed for hard-refresh SSR.
 * Cookie is ~3KB — prefer MANY slim rows over few fat ones so row 11+
 * already exists in first HTML (bodies fill in quietly from network).
 */

import type { SmsMessage } from "@/lib/types"
import {
  paintSeedCookieName,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

const MESSAGES_PAINT_SCOPE = "messages-inbox-v2"
export const MESSAGES_PAINT_COOKIE = paintSeedCookieName(MESSAGES_PAINT_SCOPE)

/** One thread preview — enough for the conversation list. */
type MessagesPaintRow = {
  id: string
  ph: string
  /** Optional — only first few rows keep a preview so the cookie fits more phones. */
  b?: string
  d: "i" | "o"
  t: string
}

export type MessagesPaintSeed = {
  organizationId: string | null
  messages: MessagesPaintRow[]
}

/** Cookie target — id/phone/dir/time only so ~40 threads fit in ~3KB SSR HTML. */
const MAX_PAINT_THREADS = 40
/** Session index can hold more — fills after hydrate without waiting on network. */
const MAX_SESSION_THREADS = 80
/** Tiny body on every cookie row so previews don’t pop in empty→text (still slim). */
const COOKIE_BODY_CHARS = 56

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : d
}

function messagesThreadIndexKey(organizationId: string | null): string {
  return persistedCacheKey("messages-thread-index", organizationId ?? "default")
}

/** Keep newest message per customer phone for the cookie / session index. */
function latestPerThread(messages: SmsMessage[], limit: number): SmsMessage[] {
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
    .slice(0, limit)
}

function trimRow(msg: SmsMessage, bodyChars: number): MessagesPaintRow {
  const phone = (msg.customer_phone?.trim() || msg.from_number || "").trim()
  const created = new Date(msg.created_at || Date.now())
  const iso = Number.isNaN(created.getTime())
    ? new Date().toISOString()
    : created.toISOString()
  const row: MessagesPaintRow = {
    id: clip(msg.id, 36),
    ph: clip(phone, 16),
    d: msg.direction === "outbound" ? "o" : "i",
    t: clip(iso, 24),
  }
  if (bodyChars > 0) {
    row.b = clip(msg.body || "", bodyChars)
  }
  return row
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
      body: row.b ?? "",
      customer_phone: row.ph,
      telnyx_message_id: null,
      status: "received",
      created_at: createdAt,
    }
  })
}

/**
 * Session thread index — survives hard refresh, larger than the cookie.
 * Used after hydrate so rows 11+ exist before the network returns.
 */
function writeMessagesThreadIndex(
  messages: SmsMessage[],
  organizationId: string | null = null
): void {
  const latest = latestPerThread(messages, MAX_SESSION_THREADS)
  const payload: MessagesPaintSeed = {
    organizationId,
    messages: latest.map((msg) => trimRow(msg, COOKIE_BODY_CHARS)),
  }
  writePersistedCache(messagesThreadIndexKey(organizationId), payload)
}

export function readMessagesThreadIndex(
  organizationId: string | null = null
): MessagesPaintSeed | null {
  const parsed = readPersistedCache<MessagesPaintSeed>(messagesThreadIndexKey(organizationId))
  if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length === 0) return null
  if (
    !operationsPaintMatchesOrg(
      { organizationId: parsed.organizationId, calls: [], fetchedAt: 0 },
      organizationId
    )
  ) {
    return null
  }
  return parsed
}

export function writeMessagesPaintSeed(
  messages: SmsMessage[],
  organizationId: string | null = null
): void {
  // Always refresh the larger session index (not size-capped like cookies).
  writeMessagesThreadIndex(messages, organizationId)

  const latest = latestPerThread(messages, MAX_PAINT_THREADS)
  let n = Math.min(MAX_PAINT_THREADS, Math.max(0, latest.length))
  while (n >= 0) {
    const payload: MessagesPaintSeed = {
      organizationId,
      // Slim: bodies only on the first few so more phones fit in ~3KB.
      messages: latest.slice(0, n).map((msg) => trimRow(msg, COOKIE_BODY_CHARS)),
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

/** True when `next` keeps every baseline thread’s latest message id (safe quiet expand). */
export function messagesThreadListIsQuietExpansion(
  baseline: SmsMessage[],
  next: SmsMessage[]
): boolean {
  if (baseline.length === 0) return false
  const latestByPhone = (messages: SmsMessage[]) => {
    const map = new Map<string, { id: string; t: number }>()
    for (const msg of messages) {
      const raw = (msg.customer_phone?.trim() || msg.from_number || "").trim()
      if (!raw) continue
      const key = phoneKey(raw) || raw
      const t = new Date(msg.created_at).getTime() || 0
      const prev = map.get(key)
      if (!prev || t >= prev.t) map.set(key, { id: msg.id, t })
    }
    return map
  }
  const baseByPhone = latestByPhone(baseline)
  const nextByPhone = latestByPhone(next)
  for (const [phone, row] of baseByPhone) {
    const live = nextByPhone.get(phone)
    if (!live || live.id !== row.id) return false
  }
  return true
}
