// Build “Latest” rows for Lines: most recent customer SMS action per thread.

import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import type { SmsMessage } from "@/lib/types"

/** Kind of outbound text (heuristic from body). */
export type LatestSmsKind = "review" | "booking" | "en_route" | "status" | "other"

/** One thread’s latest action for the Latest strip. */
export type LatestCustomerAction = {
  id: string
  customerPhone: string
  customerName: string
  /** What happened most recently. */
  event: "sent" | "replied"
  kind: LatestSmsKind
  /** e.g. “Review link sent to Jessica” */
  headline: string
  /** Short status under the headline. */
  statusLine: string
  preview: string
  at: string
  deliveryLabel: string | null
  reviewLinkOpened: boolean
  reviewLinkClicks: number
  /** Last outbound in the thread (for detail + delivery). */
  lastOutbound: {
    id: string
    body: string
    status: string
    created_at: string
    delivered_at?: string | null
    failed_at?: string | null
    delivery_error?: string | null
  } | null
  /** Last inbound reply (if any). */
  lastInbound: {
    id: string
    body: string
    created_at: string
  } | null
  /** Completed job id today (for Thanks + review), if matched. */
  completedJobId: string | null
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

function truncate(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Guess SMS template type from message body. */
export function classifyOutboundSmsKind(body: string): LatestSmsKind {
  const b = body.toLowerCase()
  if (/\/rv\/[a-z0-9]+/i.test(body) || b.includes("lyncr.app/rv")) return "review"
  if (/\breview\b/.test(b) && (b.includes("http") || b.includes("google"))) return "review"
  if (/\bon the way\b|\ben route\b|\ben-route\b/.test(b)) return "en_route"
  if (/\brunning late\b|\barrived\b|\bpaused\b|\bon site\b/.test(b)) return "status"
  if (/\bbooked\b|\bappointment\b|\bconfirmed\b|\bscheduled\b/.test(b)) return "booking"
  return "other"
}

function kindLabel(kind: LatestSmsKind): string {
  switch (kind) {
    case "review":
      return "Review link"
    case "booking":
      return "Booking text"
    case "en_route":
      return "On the way"
    case "status":
      return "Status update"
    default:
      return "Text"
  }
}

type ThreadBundle = {
  customerPhone: string
  messages: SmsMessage[]
  lastMessage: SmsMessage
}

function groupThreads(messages: SmsMessage[]): ThreadBundle[] {
  const byPhone = new Map<string, SmsMessage[]>()
  for (const msg of messages) {
    const key = (msg.customer_phone || "").trim() || msg.from_number
    if (!key) continue
    const list = byPhone.get(key) ?? []
    list.push(msg)
    byPhone.set(key, list)
  }
  const threads: ThreadBundle[] = []
  for (const [customerPhone, list] of byPhone) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const lastMessage = sorted[sorted.length - 1]
    if (!lastMessage) continue
    threads.push({ customerPhone, messages: sorted, lastMessage })
  }
  threads.sort(
    (a, b) =>
      new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  )
  return threads
}

export type LatestActionNameHint = {
  phone: string
  name: string | null
  /** Completed job id if this phone finished today. */
  completedJobId?: string | null
}

export type LatestReviewHint = {
  phone: string
  click_count: number
}

/**
 * Turn recent SMS into Latest rows (one per customer thread, newest first).
 */
export function buildLatestCustomerActions(params: {
  messages: SmsMessage[]
  nameHints?: LatestActionNameHint[]
  reviewHints?: LatestReviewHint[]
  limit?: number
}): LatestCustomerAction[] {
  const limit = params.limit ?? 5
  const nameByPhone = new Map<string, string>()
  const jobByPhone = new Map<string, string>()
  for (const h of params.nameHints ?? []) {
    const k = phoneKey(h.phone)
    if (!k) continue
    const n = (h.name || "").trim()
    // First non-empty name wins (hints should be newest-first).
    if (n && !nameByPhone.has(k)) nameByPhone.set(k, n)
    // Prefer any completed job id for Thanks + review.
    if (h.completedJobId && !jobByPhone.has(k)) jobByPhone.set(k, h.completedJobId)
  }
  const reviewByPhone = new Map<string, number>()
  for (const r of params.reviewHints ?? []) {
    const k = phoneKey(r.phone)
    if (!k) continue
    reviewByPhone.set(k, Math.max(reviewByPhone.get(k) ?? 0, r.click_count))
  }

  const threads = groupThreads(params.messages).slice(0, limit)
  const out: LatestCustomerAction[] = []

  for (const thread of threads) {
    const key = phoneKey(thread.customerPhone)
    const name = nameByPhone.get(key) || "Customer"
    const last = thread.lastMessage
    const lastOutbound =
      [...thread.messages].reverse().find((m) => m.direction === "outbound") ?? null
    const lastInbound =
      [...thread.messages].reverse().find((m) => m.direction === "inbound") ?? null

    const kind = lastOutbound ? classifyOutboundSmsKind(lastOutbound.body) : "other"
    const deliveryLabel = lastOutbound ? formatSmsDeliveryLabel(lastOutbound) : null
    const clicks = reviewByPhone.get(key) ?? 0
    const reviewOpened = clicks > 0
    const event: "sent" | "replied" = last.direction === "inbound" ? "replied" : "sent"

    let headline: string
    if (event === "replied") {
      headline = `${name} replied`
    } else if (kind === "review") {
      headline = `Review link sent to ${name}`
    } else {
      headline = `${kindLabel(kind)} sent to ${name}`
    }

    const statusParts: string[] = []
    if (event === "replied") {
      statusParts.push("New reply")
      if (deliveryLabel && lastOutbound) statusParts.push(`Prior text: ${deliveryLabel}`)
    } else if (deliveryLabel) {
      statusParts.push(deliveryLabel)
    }
    if (kind === "review") {
      if (reviewOpened) {
        statusParts.push(clicks > 1 ? `Link opened (${clicks}×)` : "Link opened")
      } else if (event === "sent") {
        statusParts.push("Waiting for open")
      }
    }
    const statusLine = statusParts.join(" · ") || "Sent"
    const preview =
      event === "replied" && lastInbound
        ? truncate(lastInbound.body)
        : lastOutbound
          ? truncate(lastOutbound.body)
          : truncate(last.body)

    out.push({
      id: `${key}-${last.id}`,
      customerPhone: thread.customerPhone,
      customerName: name,
      event,
      kind,
      headline,
      statusLine,
      preview,
      at: last.created_at,
      deliveryLabel,
      reviewLinkOpened: reviewOpened,
      reviewLinkClicks: clicks,
      lastOutbound: lastOutbound
        ? {
            id: lastOutbound.id,
            body: lastOutbound.body,
            status: lastOutbound.status,
            created_at: lastOutbound.created_at,
            delivered_at: lastOutbound.delivered_at,
            failed_at: lastOutbound.failed_at,
            delivery_error: lastOutbound.delivery_error,
          }
        : null,
      lastInbound: lastInbound
        ? {
            id: lastInbound.id,
            body: lastInbound.body,
            created_at: lastInbound.created_at,
          }
        : null,
      completedJobId: jobByPhone.get(key) ?? null,
    })
  }

  return out
}
