/**
 * Amber leftover-job coworker — parse SEND/SKIP, quiet hours, ping + draft copy.
 * Pure helpers (no DB) so tests stay fast.
 */

import { normalizeAmberSmsBody } from "@/lib/amber-commands"

/** Open thread states that wait for the owner. */
export type AmberThreadState = "awaiting_instruction" | "awaiting_send" | "sent" | "skipped" | "expired" | "ping_failed"

/** Extra owner keywords while a leftover thread is open. */
export type AmberCoworkerCommand =
  | { kind: "send" }
  | { kind: "skip" }
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "instruction"; text: string }

/** True when the whole SMS is SEND (not “yes” / “ok”). */
export function isAmberSendKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase()
  return upper === "SEND"
}

/** True when the owner wants to close without texting the customer. */
export function isAmberSkipKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    upper === "SKIP" ||
    upper === "NO" ||
    upper === "DONT" ||
    upper === "DONT SEND" ||
    upper === "DO NOT SEND" ||
    upper === "LATER" ||
    upper === "IGNORE"
  )
}

/** Owner STOP — pause leftover pings (10DLC). */
export function isAmberStopKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase()
  return (
    upper === "STOP" ||
    upper === "STOPALL" ||
    upper === "UNSUBSCRIBE" ||
    upper === "CANCEL" ||
    upper === "END" ||
    upper === "QUIT"
  )
}

/** Owner START — resume leftover pings. */
export function isAmberStartKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase()
  return upper === "START" || upper === "UNSTOP"
}

/** Parse coworker keywords; anything else is a free-text instruction. */
export function parseAmberCoworkerCommand(raw: string): AmberCoworkerCommand {
  if (isAmberSendKeyword(raw)) return { kind: "send" }
  if (isAmberSkipKeyword(raw)) return { kind: "skip" }
  if (isAmberStopKeyword(raw)) return { kind: "stop" }
  if (isAmberStartKeyword(raw)) return { kind: "start" }
  return { kind: "instruction", text: normalizeAmberSmsBody(raw) }
}

/** Shop night window (8pm–8am) in Amber’s timezone. */
export function isAmberQuietHour(timezone: string, now = new Date()): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || "America/New_York",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now)
    )
    if (!Number.isFinite(hour)) return false
    return hour >= 20 || hour < 8
  } catch {
    return false
  }
}

/** ASAP leftover pings at night; window/tomorrow jobs wait until morning. */
export function shouldHoldLeftoverPing(params: {
  urgency: string
  timezone: string
  now?: Date
}): boolean {
  const asap = String(params.urgency || "").toLowerCase() === "asap"
  if (asap) return false
  return isAmberQuietHour(params.timezone, params.now ?? new Date())
}

/** First name for SMS; empty → “there”. */
export function amberCustomerFirstName(fullName: string | null | undefined): string {
  const first = String(fullName ?? "")
    .trim()
    .split(/\s+/)[0]
  return first || "there"
}

/** Last 4 of a phone for the owner preview. */
export function amberPhoneLast4(e164: string | null | undefined): string {
  const digits = String(e164 ?? "").replace(/\D/g, "")
  if (digits.length < 4) return "????"
  return digits.slice(-4)
}

/** Short street + city for the owner ping (no full notes). */
export function amberAddressSnippet(params: {
  street?: string | null
  city?: string | null
  full?: string | null
}): string | null {
  const street = String(params.street ?? "").trim()
  const city = String(params.city ?? "").trim()
  if (street && city) return `${street}, ${city}`.slice(0, 80)
  if (street) return street.slice(0, 80)
  const full = String(params.full ?? "").trim()
  if (!full) return null
  return full.slice(0, 80)
}

/** Owner ping: facts + one question. */
export function buildAmberLeftoverPingText(params: {
  customerName: string
  jobLabel: string
  addressSnippet: string | null
  minutesAgo: number
  urgency: string
  last4?: string | null
}): string {
  const who = String(params.customerName || "Customer").trim() || "Customer"
  const job = String(params.jobLabel || "request").trim() || "request"
  const place = params.addressSnippet ? ` · ${params.addressSnippet}` : ""
  const mins = Math.max(1, Math.round(params.minutesAgo))
  const asap = String(params.urgency || "").toLowerCase() === "asap" ? " ASAP" : ""
  const last4 = String(params.last4 || "").replace(/\D/g, "").slice(-4)
  const phoneBit = last4.length === 4 ? ` · …${last4}` : ""
  return [
    `${who}${phoneBit} · ${job}${place}.${asap} Submitted ${mins} min ago, still open. What should we do?`,
    "Reply in your own words. I’ll draft the customer text. SEND to ship it, SKIP to ignore.",
  ].join(" ")
}

/** Turn owner instruction into a customer SMS (no invented prices/times). */
export function buildCustomerDraftFromInstruction(params: {
  instruction: string
  customerFirstName: string
  businessName: string
}): string {
  const who = params.customerFirstName || "there"
  const biz = String(params.businessName || "").trim() || "us"
  let body = normalizeAmberSmsBody(params.instruction)
  body = body.replace(
    /^(please\s+)?(tell|text|draft|email|let|message)\s+(him|her|them|joe|the customer)\s+(that\s+)?/i,
    ""
  )
  body = body.replace(/^(that\s+)/i, "")
  if (!body) {
    body = `Hi ${who}, we got your request and will follow up shortly.`
  } else if (!/^hi\b/i.test(body)) {
    const rest = body.charAt(0).toLowerCase() + body.slice(1)
    body = `Hi ${who} — ${rest}`
  }
  if (!new RegExp(biz.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body) && body.length < 240) {
    body = `${body.replace(/[.!?]+$/, "")}. — ${biz}`
  }
  return body.slice(0, 280)
}

/** Amber quote of the exact customer draft. */
export function buildAmberDraftPreviewText(params: {
  customerFirstName: string
  last4: string
  draftBody: string
}): string {
  const who = params.customerFirstName || "them"
  return [
    `Draft to ${who} (…${params.last4}): “${params.draftBody}”`,
    "Reply SEND to send that exact text, tell me what to change, or SKIP.",
  ].join("\n")
}

/** True when the SMS is a presence command by itself (not a customer-draft instruction). */
export function isBareAmberPresenceCommand(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase()
  return (
    /^(HELP|\?|HI|HELLO|STATUS|STAT|AVAILABLE|AVAIL|FREE|BUSY)\b/.test(upper) ||
    /^I'?M\s+(FREE|AVAILABLE)\b/.test(upper) ||
    /^MAKE\s+ME\s+BUSY\b/.test(upper) ||
    /^SET\s+ME\s+(TO\s+)?BUSY\b/.test(upper)
  )
}

/** Extra HELP lines for leftover jobs. */
export function amberCoworkerHelpLines(): string[] {
  return [
    "Leftover book jobs: I’ll text you, then draft a customer SMS.",
    "SEND — send the quoted draft from your business line.",
    "SKIP — close without texting the customer.",
    "STOP — pause leftover pings. START — resume.",
  ]
}
