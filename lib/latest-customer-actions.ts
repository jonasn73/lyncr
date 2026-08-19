// Build “Latest” rows for Lines: hot work + recent customer payments.

import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import type { SmsMessage } from "@/lib/types"
import { isHoldPress1BookingSource } from "@/lib/owner-live-call"

/** Kind of outbound text (heuristic from body), or a finished job / payment row. */
export type LatestSmsKind = "review" | "booking" | "en_route" | "status" | "other" | "job" | "paid"

/**
 * One Latest row.
 * - `replied` — customer text needs an answer
 * - `job_finished` — needs Thanks + review SMS
 * - `customer_paid` — card / pay-link just settled (informational)
 * - `book_form` — customer finished public /book (ASAP or window)
 * Outbound “we sent X” never stays here.
 */
export type LatestCustomerAction = {
  id: string
  customerPhone: string
  customerName: string
  /** What needs attention (or a recent payment / book-form notice). */
  event: "replied" | "job_finished" | "customer_paid" | "book_form"
  kind: LatestSmsKind
  /** e.g. “David replied” / “Jason · job finished” / “Customer submitted book form · ASAP” */
  headline: string
  /** Short status under the headline. */
  statusLine: string
  preview: string
  at: string
  deliveryLabel: string | null
  reviewLinkOpened: boolean
  reviewLinkClicks: number
  /** Last outbound in the thread (for detail + delivery context). */
  lastOutbound: {
    id: string
    body: string
    status: string
    created_at: string
    delivered_at?: string | null
    failed_at?: string | null
    delivery_error?: string | null
    /** False when we have no Telnyx id to receive carrier delivery receipts. */
    deliveryTracked?: boolean
  } | null
  /** Last inbound reply (if any). */
  lastInbound: {
    id: string
    body: string
    created_at: string
  } | null
  /** Completed job id today (for Thanks + review), if matched. */
  completedJobId: string | null
  /** Settled charge amount in cents (customer_paid only). */
  paidAmountCents?: number | null
  /**
   * Payment row also needs Thanks + review for the same job/customer.
   * Merges the duplicate “job finished” alert onto the payment card.
   */
  thanksReviewPending?: boolean
  /** Open ai_leads id for book_form rows (Open intake). */
  bookFormLeadId?: string | null
  /** asap | window for book_form rows. */
  bookFormUrgency?: "asap" | "window" | null
  /** Prefill seeds so Open intake hydrates before CRM fetch. */
  bookFormJobKind?: string | null
  bookFormJobType?: string | null
  bookFormServiceQuoteTypeId?: string | null
  bookFormVehicleYear?: string | null
  bookFormVehicleMake?: string | null
  bookFormVehicleModel?: string | null
  bookFormAddressLine1?: string | null
  bookFormQuotedPriceCents?: number | null
}

export type LatestCompletedJobHint = {
  id: string
  customerPhone: string | null
  customerName: string | null
  location: string | null
  summary: string | null
  /** When the job finished / was scheduled (for sorting). */
  at: string
  /** Thanks + review already sent (job stamp) — excludes from Latest. */
  reviewSmsSentAt?: string | null
  /** Owner confirmed / tracked review open (job stamp). */
  reviewLinkOpenedAt?: string | null
}

/** One completed wallet payment to surface as “Customer paid”. */
export type LatestPaidHint = {
  /** wallet_transactions.id — stable Latest row id. */
  id: string
  customerPhone: string | null
  customerName: string | null
  /** Amount the customer paid, in cents. */
  amountCents: number
  /** When the ledger row was created / settled. */
  at: string
  /** Job id when this was a job charge (opens Collect / job). */
  jobId: string | null
  /** Short vehicle / job label for the preview line. */
  jobLabel: string | null
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

function truncate(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Dollar label for Latest headlines (e.g. $265 or $257.01). */
function formatPaidDollars(cents: number): string {
  const safe = Math.max(0, Math.round(cents))
  return (safe / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: safe % 100 === 0 ? 0 : 2,
  })
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
  /** Owner/tracked review open timestamp. */
  reviewLinkOpenedAt?: string | null
}

export type LatestReviewHint = {
  phone: string
  click_count: number
}

/** One customer book-form submit to surface in Latest. */
export type LatestBookFormHint = {
  /** ai_leads.id */
  id: string
  customerPhone: string | null
  customerName: string | null
  /** When the form was saved. */
  at: string
  urgency: "asap" | "window"
  /** e.g. ASAP / emergency or “Today 1:00 PM–5:00 PM”. */
  availabilityLabel: string | null
  /** Short job / vehicle preview. */
  preview: string | null
  /** Book chip id (lockout | akl | copy | other). */
  jobKind?: string | null
  jobType?: string | null
  serviceQuoteTypeId?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  addressLine1?: string | null
  quotedPriceCents?: number | null
  /** Invite SMS source — hold/press-1 when set. */
  bookingSource?: string | null
}

/** Default: drop unreplied inbound older than this (stale “1d ago” noise). */
export const LATEST_INBOUND_MAX_AGE_HOURS = 24

/** Default: keep “Customer paid” rows for this many hours after settle. */
export const LATEST_PAID_MAX_AGE_HOURS = 24

/** Default: keep book-form rows for this many hours after submit. */
export const LATEST_BOOK_FORM_MAX_AGE_HOURS = 48

/**
 * Hot Latest:
 * 1) Unreplied inbound SMS (customer last messaged you) — age-capped
 * 2) Customer book-form submits (ASAP / window)
 * 3) Recent completed payments (“Customer paid · $X · Name”)
 *    — if that job still needs Thanks + review, nest Send thanks on the payment card
 * 4) Today’s completed jobs that still need a Thanks + review text
 *    (skipped when a payment card for the same job/customer already covers it)
 *
 * Outbound-only threads (“Review link sent…”) are never listed.
 * Cap ~4–6; unreplied first, then book forms, then payments, then action-needed jobs.
 */
export function buildLatestCustomerActions(params: {
  messages: SmsMessage[]
  nameHints?: LatestActionNameHint[]
  reviewHints?: LatestReviewHint[]
  completedJobs?: LatestCompletedJobHint[]
  /** Recent COMPLETED wallet payments (from owner-collected). */
  recentPayments?: LatestPaidHint[]
  /** Recent public /book or Activity book-link submits. */
  bookForms?: LatestBookFormHint[]
  limit?: number
  /** Drop unreplied inbound older than this many hours (default 24). */
  maxAgeHours?: number
  /** Drop customer_paid older than this many hours (default 24). */
  paidMaxAgeHours?: number
  /** Drop book_form older than this many hours (default 48). */
  bookFormMaxAgeHours?: number
  /** Injected clock for tests. */
  nowMs?: number
}): LatestCustomerAction[] {
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 6)
  const maxAgeHours = params.maxAgeHours ?? LATEST_INBOUND_MAX_AGE_HOURS
  const paidMaxAgeHours = params.paidMaxAgeHours ?? LATEST_PAID_MAX_AGE_HOURS
  const bookFormMaxAgeHours = params.bookFormMaxAgeHours ?? LATEST_BOOK_FORM_MAX_AGE_HOURS
  const nowMs = params.nowMs ?? Date.now()
  const inboundCutoff = nowMs - maxAgeHours * 60 * 60 * 1000
  const paidCutoff = nowMs - paidMaxAgeHours * 60 * 60 * 1000
  const bookFormCutoff = nowMs - bookFormMaxAgeHours * 60 * 60 * 1000

  const nameByPhone = new Map<string, string>()
  const openedByPhone = new Map<string, string>()
  for (const h of params.nameHints ?? []) {
    const k = phoneKey(h.phone)
    if (!k) continue
    const n = (h.name || "").trim()
    // First non-empty name wins (hints should be newest-first).
    if (n && !nameByPhone.has(k)) nameByPhone.set(k, n)
    if (h.reviewLinkOpenedAt?.trim() && !openedByPhone.has(k)) {
      openedByPhone.set(k, h.reviewLinkOpenedAt.trim())
    }
  }

  const reviewByPhone = new Map<string, number>()
  for (const r of params.reviewHints ?? []) {
    const k = phoneKey(r.phone)
    if (!k) continue
    reviewByPhone.set(k, Math.max(reviewByPhone.get(k) ?? 0, r.click_count))
  }

  // Jobs that still need a review text (today-scoped by the API).
  const jobsNeedingReview = (params.completedJobs ?? []).filter(
    (job) => !(job.reviewSmsSentAt || "").trim()
  )
  const reviewJobByPhone = new Map<string, LatestCompletedJobHint>()
  for (const job of jobsNeedingReview) {
    const k = phoneKey(job.customerPhone || "")
    if (k && !reviewJobByPhone.has(k)) reviewJobByPhone.set(k, job)
  }

  const threads = groupThreads(params.messages)
  const out: LatestCustomerAction[] = []
  const phonesWithReply = new Set<string>()

  for (const thread of threads) {
    const last = thread.lastMessage
    // Outbound-only / last-touch-was-us → hide immediately (not hot work).
    if (last.direction !== "inbound") continue

    const atMs = Date.parse(last.created_at) || 0
    if (atMs && atMs < inboundCutoff) continue

    const key = phoneKey(thread.customerPhone)
    if (key) phonesWithReply.add(key)

    const name = (key && nameByPhone.get(key)) || "Customer"
    const lastOutbound =
      [...thread.messages].reverse().find((m) => m.direction === "outbound") ?? null
    const lastInbound =
      [...thread.messages].reverse().find((m) => m.direction === "inbound") ?? null

    const kind = lastOutbound ? classifyOutboundSmsKind(lastOutbound.body) : "other"
    const deliveryLabel = lastOutbound ? formatSmsDeliveryLabel(lastOutbound) : null
    const clicks = (key && reviewByPhone.get(key)) || 0
    const openedStamp = key ? openedByPhone.get(key) : undefined
    const reviewOpened = clicks > 0 || Boolean(openedStamp)

    // Only attach a job id when today’s completed job still needs a review text.
    const reviewJob = key ? reviewJobByPhone.get(key) : undefined
    const completedJobId = reviewJob?.id ?? null

    const statusParts: string[] = ["Needs reply"]
    if (deliveryLabel && lastOutbound) statusParts.push(`Prior text: ${deliveryLabel}`)

    out.push({
      id: `${key || thread.customerPhone}-reply-${last.id}`,
      customerPhone: thread.customerPhone,
      customerName: name,
      event: "replied",
      kind,
      headline: `${name} replied`,
      statusLine: statusParts.join(" · "),
      preview: lastInbound ? truncate(lastInbound.body) : truncate(last.body),
      at: last.created_at,
      deliveryLabel,
      reviewLinkOpened: reviewOpened,
      reviewLinkClicks: Math.max(clicks, reviewOpened ? 1 : 0),
      lastOutbound: lastOutbound
        ? {
            id: lastOutbound.id,
            body: lastOutbound.body,
            status: lastOutbound.status,
            created_at: lastOutbound.created_at,
            delivered_at: lastOutbound.delivered_at,
            failed_at: lastOutbound.failed_at,
            delivery_error: lastOutbound.delivery_error,
            deliveryTracked: Boolean(lastOutbound.telnyx_message_id),
          }
        : null,
      lastInbound: lastInbound
        ? {
            id: lastInbound.id,
            body: lastInbound.body,
            created_at: lastInbound.created_at,
          }
        : null,
      completedJobId,
      paidAmountCents: null,
    })
  }

  // Phones / job ids already covered by a payment row (used to suppress duplicate thanks alerts).
  const paidPhones = new Set<string>()
  const paidJobIds = new Set<string>()

  // Recent settled payments — “Customer paid · $265 · Alex” (persists via wallet_transactions).
  for (const pay of params.recentPayments ?? []) {
    const amountCents = Math.round(Number(pay.amountCents) || 0)
    if (amountCents <= 0) continue
    const atMs = Date.parse(pay.at) || 0
    if (atMs && atMs < paidCutoff) continue

    const phone = (pay.customerPhone || "").trim()
    const key = phoneKey(phone)
    const name =
      (pay.customerName || "").trim() || (key ? nameByPhone.get(key) : null) || "Customer"
    const dollars = formatPaidDollars(amountCents)

    // Same job or same phone still needs Thanks + review — nest that action on this card.
    const reviewJobForPay =
      (pay.jobId && jobsNeedingReview.find((j) => j.id === pay.jobId)) ||
      (key ? reviewJobByPhone.get(key) : undefined) ||
      null
    const thanksPending = Boolean(reviewJobForPay)
    const completedJobId = pay.jobId || reviewJobForPay?.id || null

    if (key) paidPhones.add(key)
    if (completedJobId) paidJobIds.add(completedJobId)

    out.push({
      id: `paid-${pay.id}`,
      customerPhone: phone,
      customerName: name,
      event: "customer_paid",
      kind: "paid",
      headline: `Customer paid · ${dollars} · ${name}`,
      statusLine: thanksPending
        ? "Payment received · Send thanks"
        : "Payment received",
      preview: (pay.jobLabel || "Card / pay link").trim(),
      at: pay.at,
      deliveryLabel: null,
      reviewLinkOpened: false,
      reviewLinkClicks: 0,
      lastOutbound: null,
      lastInbound: null,
      completedJobId,
      paidAmountCents: amountCents,
      thanksReviewPending: thanksPending,
    })
  }

  // Public /book (and Activity book-link) submits — stay hot until owner opens intake.
  const phonesWithBookForm = new Set<string>()
  for (const form of params.bookForms ?? []) {
    const atMs = Date.parse(form.at) || 0
    if (atMs && atMs < bookFormCutoff) continue
    const phone = (form.customerPhone || "").trim()
    const key = phoneKey(phone)
    // Keep the form even if they also texted — Messages needs “filled vs not”.
    if (key && phonesWithBookForm.has(key)) continue
    if (key) phonesWithBookForm.add(key)

    const name =
      (form.customerName || "").trim() || (key ? nameByPhone.get(key) : null) || "Customer"
    const urgency = form.urgency === "asap" ? "asap" : "window"
    const urgencyLabel = urgency === "asap" ? "ASAP" : "window"
    const avail =
      (form.availabilityLabel || "").trim() ||
      (urgency === "asap" ? "ASAP / emergency" : "Preferred window")
    // Hold / press-1 bookings get a clearer one-card headline for owners.
    const fromHold = isHoldPress1BookingSource(form.bookingSource)
    const headline = fromHold
      ? `Booked from hold · press 1 · ${urgencyLabel}`
      : `Customer submitted book form · ${urgencyLabel}`

    out.push({
      id: `book-${form.id}`,
      customerPhone: phone,
      customerName: name,
      event: "book_form",
      kind: "booking",
      headline,
      statusLine: name,
      preview: truncate((form.preview || avail).trim() || avail),
      at: form.at,
      deliveryLabel: null,
      reviewLinkOpened: false,
      reviewLinkClicks: 0,
      lastOutbound: null,
      lastInbound: null,
      completedJobId: null,
      paidAmountCents: null,
      bookFormLeadId: form.id,
      bookFormUrgency: urgency,
      bookFormJobKind: form.jobKind ?? null,
      bookFormJobType: form.jobType ?? null,
      bookFormServiceQuoteTypeId: form.serviceQuoteTypeId ?? null,
      bookFormVehicleYear: form.vehicleYear ?? null,
      bookFormVehicleMake: form.vehicleMake ?? null,
      bookFormVehicleModel: form.vehicleModel ?? null,
      bookFormAddressLine1: form.addressLine1 ?? null,
      bookFormQuotedPriceCents: form.quotedPriceCents ?? null,
    })
  }

  // Completed today, review SMS not sent yet — amber “Send thanks + review” slot.
  for (const job of jobsNeedingReview) {
    const phone = (job.customerPhone || "").trim()
    const key = phoneKey(phone)
    // Same phone already in Latest as unreplied inbound — keep reply priority.
    if (key && phonesWithReply.has(key)) continue
    // Book-form row already covers this phone.
    if (key && phonesWithBookForm.has(key)) continue
    // Payment alert for this job/customer already nests “Send thanks” — skip duplicate.
    if (paidJobIds.has(job.id)) continue
    if (key && paidPhones.has(key)) continue

    const name =
      (job.customerName || "").trim() || (key ? nameByPhone.get(key) : null) || "Customer"

    out.push({
      id: `job-${job.id}`,
      customerPhone: phone,
      customerName: name,
      event: "job_finished",
      kind: "job",
      headline: `${name} · job finished`,
      statusLine: "Send thanks + review",
      preview: (job.location || job.summary || "Completed").trim(),
      at: job.at,
      deliveryLabel: null,
      reviewLinkOpened: false,
      reviewLinkClicks: 0,
      lastOutbound: null,
      lastInbound: null,
      completedJobId: job.id,
      paidAmountCents: null,
    })
  }

  // Unreplied → book forms → payments → jobs needing review; newest within each bucket.
  out.sort((a, b) => {
    const rank = (ev: LatestCustomerAction["event"]) => {
      if (ev === "replied") return 0
      if (ev === "book_form") return 1
      if (ev === "customer_paid") return 2
      return 3
    }
    const r = rank(a.event) - rank(b.event)
    if (r !== 0) return r
    return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)
  })

  const ranked = out.slice()
  const capped = ranked.slice(0, limit)
  const kept = new Set(capped.map((row) => row.id))
  // Don’t drop a filled form just because six other texts filled the cap.
  for (const row of ranked) {
    if (row.event === "book_form" && !kept.has(row.id)) {
      capped.push(row)
      kept.add(row.id)
    }
  }
  return capped
}

/** Drop stale session-cache rows that used the old outbound “sent” shape. */
export function isHotLatestAction(
  item: LatestCustomerAction | { event?: string }
): item is LatestCustomerAction {
  return (
    item.event === "replied" ||
    item.event === "job_finished" ||
    item.event === "customer_paid" ||
    item.event === "book_form"
  )
}

/**
 * Drop paint/session Latest rows that are past the same age caps as the live feed.
 * Stops “2d ago” alerts flashing after refresh when the unreplied window shrank.
 */
export function isFreshLatestPaintItem(
  item: LatestCustomerAction,
  nowMs = Date.now()
): boolean {
  const atMs = Date.parse(item.at) || 0
  if (!atMs) return true
  if (item.event === "replied") {
    return atMs >= nowMs - LATEST_INBOUND_MAX_AGE_HOURS * 60 * 60 * 1000
  }
  if (item.event === "customer_paid") {
    return atMs >= nowMs - LATEST_PAID_MAX_AGE_HOURS * 60 * 60 * 1000
  }
  if (item.event === "book_form") {
    return atMs >= nowMs - LATEST_BOOK_FORM_MAX_AGE_HOURS * 60 * 60 * 1000
  }
  // job_finished is day-scoped by the API — keep paint rows until Clear / send.
  return true
}
