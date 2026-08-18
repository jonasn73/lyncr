/**
 * Amber SMS command parser (Phase 1) — pure helpers, no I/O.
 * Understands short commands and simple natural language for Busy / Available.
 */

export type AmberCommand =
  | { kind: "help" }
  | { kind: "greeting" }
  | { kind: "status" }
  | { kind: "briefing" }
  | { kind: "available" }
  | { kind: "busy"; untilLocalTime: string | null }
  | { kind: "unknown"; raw: string }

/** Normalize owner SMS body for matching. */
export function normalizeAmberSmsBody(raw: string): string {
  // iPhone often inserts curly apostrophes in I’m / don’t.
  return raw
    .replace(/[\u2018\u2019\u201B`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when the owner is just saying hi — not asking for the full command list. */
export function isAmberGreetingPhrase(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    upper === "HI" ||
    upper === "HEY" ||
    upper === "HELLO" ||
    upper === "YO" ||
    upper === "SUP" ||
    /^HEY\s+(AMBER|THERE|LYNCR)\b/.test(upper) ||
    /^HI\s+(AMBER|THERE|LYNCR)\b/.test(upper) ||
    /^HELLO\s+(AMBER|THERE|LYNCR)\b/.test(upper) ||
    /^GOOD (MORNING|AFTERNOON|EVENING|NIGHT)\b/.test(upper)
  )
}

/** Short hello with live Busy/Available — not a cheat-sheet. */
export function amberHelloSms(params: { busy: boolean; untilLabel: string | null }): string {
  const status = params.busy
    ? params.untilLabel
      ? `You’re Busy until ${params.untilLabel}. Your phone does not ring first.`
      : "You’re Busy. Your phone does not ring first."
    : "You’re Available. Your phone rings first."
  return `Hey. ${status} You can text What’s my status, I’m slammed until 4:30, or I’m free.`
}

/** True when the owner wants a short “what still needs me” leftover list. */
export function isAmberBriefingPhrase(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    /ANY IMPORTANT EVENTS/.test(upper) ||
    /ANYTHING (IMPORTANT|WAITING|OPEN|I SHOULD KNOW)/.test(upper) ||
    /WHATS WAITING/.test(upper) ||
    /WHATS OPEN/.test(upper) ||
    /WHATS LEFTOVER/.test(upper) ||
    /ANYTHING I NEED/.test(upper) ||
    upper === "BRIEFING" ||
    upper === "WHATS UP" ||
    upper === "ANYTHING?" ||
    upper === "UPDATES" ||
    upper === "WHAT DID I MISS"
  )
}

/** True when the owner is asking Busy/Available — not setting Busy. */
export function isAmberStatusPhrase(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    upper === "STATUS" ||
    upper === "STAT" ||
    upper === "MY STATUS" ||
    upper === "WHATS MY STATUS" ||
    upper === "WHAT IS MY STATUS" ||
    upper === "WHATS THE STATUS" ||
    upper === "WHAT IS THE STATUS" ||
    upper === "HOWS MY STATUS" ||
    upper === "HOW IS MY STATUS" ||
    upper === "AM I BUSY" ||
    upper === "AM I AVAILABLE" ||
    upper === "AM I FREE" ||
    /^WHATS MY (STATUS|AVAILABILITY)\b/.test(upper) ||
    /^WHAT IS MY (STATUS|AVAILABILITY)\b/.test(upper) ||
    /^AM I (BUSY|AVAILABLE|FREE)\b/.test(upper)
  )
}

/**
 * Parse an owner reply to Amber.
 * Phase 1: HELP, greeting, STATUS, briefing, BUSY, AVAILABLE, and phrases like "busy until 4:30".
 */
export function parseAmberCommand(raw: string): AmberCommand {
  const text = normalizeAmberSmsBody(raw)
  if (!text) return { kind: "unknown", raw: "" }

  const upper = text.toUpperCase().replace(/'/g, "")

  if (upper === "HELP" || upper === "?") {
    return { kind: "help" }
  }
  if (isAmberGreetingPhrase(text)) {
    return { kind: "greeting" }
  }
  if (isAmberStatusPhrase(text)) {
    return { kind: "status" }
  }
  if (isAmberBriefingPhrase(text)) {
    return { kind: "briefing" }
  }
  if (
    upper === "AVAILABLE" ||
    upper === "AVAIL" ||
    upper === "FREE" ||
    /^I'?M\s+FREE\b/i.test(text) ||
    /^I'?M\s+AVAILABLE\b/i.test(text)
  ) {
    return { kind: "available" }
  }

  // BUSY or "make me busy" / "busy until 4:30" / "busy until 4:30pm"
  const untilMatch = text.match(
    /\buntil\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i
  )
  const untilLocalTime = untilMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null

  if (
    upper === "BUSY" ||
    /^BUSY\b/i.test(text) ||
    /\bmake\s+me\s+busy\b/i.test(text) ||
    /\bi'?m\s+on\s+a\s+job\b/i.test(text) ||
    /\bset\s+me\s+(to\s+)?busy\b/i.test(text) ||
    /\bi'?m\s+slammed\b/i.test(text) ||
    /\bi'?m\s+busy\b/i.test(text) ||
    /^slammed\s+until\b/i.test(text)
  ) {
    return { kind: "busy", untilLocalTime }
  }

  return { kind: "unknown", raw: text }
}

/**
 * Turn "4:30", "4:30pm", "16:30" into today/tomorrow Date in a timezone.
 * Returns null when the time cannot be parsed.
 */
export function resolveAmberUntilInstant(params: {
  untilLocalTime: string
  timezone: string
  nowMs?: number
}): Date | null {
  const raw = params.untilLocalTime.trim().toLowerCase().replace(/\./g, "")
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null

  let hour = Number(m[1])
  const minute = m[2] != null ? Number(m[2]) : 0
  const mer = m[3] ?? null
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }
  if (mer === "pm" && hour < 12) hour += 12
  if (mer === "am" && hour === 12) hour = 0
  if (!mer && hour > 23) return null
  if (hour < 0 || hour > 23) return null

  const now = params.nowMs != null ? new Date(params.nowMs) : new Date()
  const tz = params.timezone.trim() || "America/New_York"

  // Build "today at H:MM" in the business timezone via Intl parts.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""

  const y = Number(get("year"))
  const mo = Number(get("month"))
  const d = Number(get("day"))
  if (!y || !mo || !d) return null

  // Approximate: interpret wall time as US offset via iterative formatter (good enough for Phase 1).
  const guessUtc = Date.UTC(y, mo - 1, d, hour, minute, 0)
  // Adjust so that formatting in tz yields the desired hour/minute.
  let candidate = new Date(guessUtc)
  for (let i = 0; i < 4; i++) {
    const check = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(candidate)
    const ch = Number(check.find((p) => p.type === "hour")?.value ?? NaN)
    const cm = Number(check.find((p) => p.type === "minute")?.value ?? NaN)
    const cy = Number(check.find((p) => p.type === "year")?.value ?? NaN)
    const cmo = Number(check.find((p) => p.type === "month")?.value ?? NaN)
    const cd = Number(check.find((p) => p.type === "day")?.value ?? NaN)
    if (ch === hour && cm === minute && cy === y && cmo === mo && cd === d) break
    const deltaMin = (hour - ch) * 60 + (minute - cm)
    candidate = new Date(candidate.getTime() + deltaMin * 60_000)
  }

  // If that wall time already passed today, roll to tomorrow.
  if (candidate.getTime() <= now.getTime() + 60_000) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000)
  }

  return candidate
}

/** Owner-facing HELP text. */
export function amberHelpText(): string {
  return [
    "Amber · Lyncr — your business assistant by text.",
    "BUSY — skip your phone (Busy routing).",
    "BUSY until 4:30 — Busy, then Available at that time.",
    "AVAILABLE — your phone rings first again.",
    "STATUS — Busy/Available right now. “What’s my status” works too.",
    "Any important events? — leftover book jobs still waiting (first names only).",
    "HELP — this list.",
    "If a book request sits, I’ll ping you with a draft. Reply ok to send it.",
    "Tell me what to change, skip Noah, or say don’t text them.",
    "No reply in 15 min → I tell them we got it.",
    "I’m slammed until 4 — Busy, then Available at that time.",
    "STOP — pause leftover pings. START — resume.",
    "Customers never see this Amber number.",
  ].join("\n")
}

/** Format Amber “Busy until” for SMS and Lines UI. */
export function formatAmberUntilLabel(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at)
  } catch {
    return at.toISOString()
  }
}
