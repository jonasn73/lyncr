/**
 * Amber leftover-job coworker — parse SEND/SKIP, quiet hours, ping + draft copy.
 * Pure helpers (no DB) so tests stay fast.
 */

import { isAmberGreetingPhrase, isAmberStatusPhrase, normalizeAmberSmsBody } from "@/lib/amber-commands"

/** Minutes we wait after a leftover ping before covering the customer (keep in sync with SQL). */
export const AMBER_SILENT_LEFTOVER_MINUTES = 15
/** Same wait in milliseconds for tests and draft timers. */
export const AMBER_SILENT_LEFTOVER_MS = AMBER_SILENT_LEFTOVER_MINUTES * 60 * 1000
/** Words after “skip” that are not a customer name (keep as an instruction). */
const SKIP_NAME_STOPWORDS = new Set([
  "THIS",
  "IT",
  "ONE",
  "THE",
  "A",
  "AN",
  "UNTIL",
  "TO",
  "MY",
  "YOUR",
  "ME",
  "US",
])

/** Open thread states that wait for the owner. */
export type AmberThreadState = "awaiting_instruction" | "awaiting_send" | "sent" | "skipped" | "expired" | "ping_failed"

/** True when the leftover ping is old enough to auto-send the holding note. */
export function isAmberSilentLeftoverDue(params: {
  pingedAt: Date | string | null | undefined
  now?: Date
  waitMs?: number
}): boolean {
  if (!params.pingedAt) return false
  const pinged = params.pingedAt instanceof Date ? params.pingedAt : new Date(params.pingedAt)
  const ms = pinged.getTime()
  if (!Number.isFinite(ms)) return false
  const wait = params.waitMs ?? AMBER_SILENT_LEFTOVER_MS
  return (params.now ?? new Date()).getTime() - ms >= wait
}

/** True when Book / Call / Clear is for the leftover Amber is holding. */
export function amberLeftoverMatchesHandledJob(params: {
  threadLeadId: string | null | undefined
  threadPhone: string | null | undefined
  leadId?: string | null
  customerPhone?: string | null
}): boolean {
  const lead = String(params.leadId || "").trim()
  const threadLead = String(params.threadLeadId || "").trim()
  if (lead && threadLead && lead === threadLead) return true
  const a = String(params.customerPhone || "").replace(/\D/g, "").slice(-10)
  const b = String(params.threadPhone || "").replace(/\D/g, "").slice(-10)
  return a.length >= 10 && a === b
}

export type AmberCoworkerCommand =
  | { kind: "send" }
  | { kind: "skip" }
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "instruction"; text: string }

/** True when the owner is approving the quoted draft (normal talk, not a password). */
export function isAmberSendKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    upper === "SEND" ||
    upper === "YES" ||
    upper === "YEP" ||
    upper === "YEAH" ||
    upper === "YEA" ||
    upper === "OK" ||
    upper === "OKAY" ||
    upper === "SEND IT" ||
    upper === "SEND THAT" ||
    upper === "SEND THIS" ||
    upper === "YEAH SEND IT" ||
    upper === "YES SEND IT" ||
    upper === "YEP SEND IT" ||
    upper === "GO AHEAD" ||
    upper === "LOOKS GOOD" ||
    upper === "SHIP IT" ||
    upper === "DO IT"
  )
}

/** True when “skip Noah” / “don’t text Joe” names the leftover (not “skip until tomorrow”). */
export function isAmberSkipNamedLeftover(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  // skip Noah  /  skip Noah Medley
  const skipName = /^SKIP\s+([A-Z][A-Z'-]{1,24})(?:\s|$)/.exec(upper)
  if (skipName && !SKIP_NAME_STOPWORDS.has(skipName[1])) return true
  const passName = /^PASS ON\s+([A-Z][A-Z'-]{1,24})(?:\s|$)/.exec(upper)
  if (passName && !SKIP_NAME_STOPWORDS.has(passName[1])) return true
  // don’t text Noah (him/her/them already match the exact skip list)
  const dontName = /^(?:DONT|DO NOT)\s+TEXT\s+([A-Z][A-Z'-]{1,24})(?:\s|$)/.exec(upper)
  if (!dontName) return false
  const token = dontName[1]
  if (token === "THEM" || token === "HIM" || token === "HER") return false
  return !SKIP_NAME_STOPWORDS.has(token)
}

/** True when the owner wants to close without texting the customer. */
export function isAmberSkipKeyword(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    upper === "SKIP" ||
    upper === "SKIP THIS" ||
    upper === "SKIP THIS ONE" ||
    upper === "SKIP IT" ||
    upper === "NO" ||
    upper === "NAH" ||
    upper === "NOPE" ||
    upper === "DONT" ||
    upper === "DONT SEND" ||
    upper === "DO NOT SEND" ||
    upper === "DONT TEXT THEM" ||
    upper === "DONT TEXT HIM" ||
    upper === "DONT TEXT HER" ||
    upper === "DO NOT TEXT THEM" ||
    upper === "NEVERMIND" ||
    upper === "NEVER MIND" ||
    upper === "LATER" ||
    upper === "IGNORE" ||
    upper === "SKIP THAT" ||
    upper === "SKIP HIM" ||
    upper === "SKIP HER" ||
    upper === "PASS" ||
    upper === "PASS ON THIS" ||
    upper === "PASS ON IT" ||
    // skip Noah — one open leftover, so naming them skips that ping
    isAmberSkipNamedLeftover(raw)
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
  draftBody?: string | null
}): string {
  const who = String(params.customerName || "Customer").trim() || "Customer"
  const job = String(params.jobLabel || "request").trim() || "request"
  const place = params.addressSnippet ? ` · ${params.addressSnippet}` : ""
  const mins = Math.max(1, Math.round(params.minutesAgo))
  const asap = String(params.urgency || "").toLowerCase() === "asap" ? " ASAP" : ""
  const last4 = String(params.last4 || "").replace(/\D/g, "").slice(-4)
  const phoneBit = last4.length === 4 ? ` · …${last4}` : ""
  const draft = String(params.draftBody || "").trim()
  const lines = [
    `${who}${phoneBit} · ${job}${place}.${asap} Submitted ${mins} min ago, still open.`,
  ]
  if (draft) {
    lines.push(`I’d send: “${draft}”`)
    lines.push("Reply ok to send that, tell me what to change, or don’t text them.")
  } else {
    lines.push("What should I text them? Or say if you don’t want to.")
  }
  lines.push("If I don’t hear back in 15 min, I’ll tell them we got the request.")
  return lines.join(" ")
}

/** Boring holding SMS — no ETAs, prices, or “we’re on the way.” */
export function buildGotItHoldingCustomerSms(params: {
  customerFirstName: string
  businessName: string
}): string {
  const who = params.customerFirstName || "there"
  const biz = String(params.businessName || "").trim() || "us"
  return `Hi ${who} — we got your request. We’ll follow up. — ${biz}`
}

/** Private Amber recap after the holding SMS goes out. */
export function buildGotItOwnerRecapSms(params: {
  customerFirstName: string
  alreadySent?: boolean
}): string {
  const who = params.customerFirstName || "the customer"
  if (params.alreadySent) {
    return `${who} already got a shop text. Moving on to the next leftover.`
  }
  return `Told ${who} we got the request. Next leftover can ping now.`
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
    body = `Hi ${who}, we got your request and will follow up.`
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
    "Want me to send that? Reply ok if it’s right, tell me what to change, or don’t send it.",
  ].join("\n")
}

/** True when the SMS is a presence command by itself (not a customer-draft instruction). */
export function isBareAmberPresenceCommand(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase()
  return (
    isAmberStatusPhrase(raw) ||
    isAmberGreetingPhrase(raw) ||
    /^(HELP|\?|HI|HELLO|STATUS|STAT|AVAILABLE|AVAIL|FREE|BUSY)\b/.test(upper) ||
    /^I'?M\s+(FREE|AVAILABLE)\b/.test(upper) ||
    /^MAKE\s+ME\s+BUSY\b/.test(upper) ||
    /^SET\s+ME\s+(TO\s+)?BUSY\b/.test(upper) ||
    /^I'?M\s+ON\s+A\s+JOB\b/.test(upper) ||
    /^I'?M\s+SLAMMED\b/.test(upper) ||
    /^I'?M\s+BUSY\b/.test(upper) ||
    /^SLAMMED\s+UNTIL\b/.test(upper)
  )
}

/** Extra HELP lines for leftover jobs. */
export function amberCoworkerHelpLines(): string[] {
  return [
    "If a book request sits, I’ll ping you with a draft. Reply ok to send it.",
    "Tell me what to say and I’ll show a new draft. Skip Noah or don’t text them to skip.",
    "No reply in 15 min → I tell them we got it.",
    "STOP — pause leftover pings. START — resume.",
  ]
}
