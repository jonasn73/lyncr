/**
 * Amber SMS command parser (Phase 1) — pure helpers, no I/O.
 * Understands short commands and simple natural language for Busy / Available.
 */

export type AmberCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "available" }
  | { kind: "busy"; untilLocalTime: string | null }
  | { kind: "unknown"; raw: string }

/** Normalize owner SMS body for matching. */
export function normalizeAmberSmsBody(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
}

/**
 * Parse an owner reply to Amber.
 * Phase 1: HELP, STATUS, BUSY, AVAILABLE, and phrases like "busy until 4:30".
 */
export function parseAmberCommand(raw: string): AmberCommand {
  const text = normalizeAmberSmsBody(raw)
  if (!text) return { kind: "unknown", raw: "" }

  const upper = text.toUpperCase()

  if (upper === "HELP" || upper === "?" || upper === "HI" || upper === "HELLO") {
    return { kind: "help" }
  }
  if (upper === "STATUS" || upper === "STAT") {
    return { kind: "status" }
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
    /\bset\s+me\s+(to\s+)?busy\b/i.test(text)
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
    "STATUS — Busy/Available right now.",
    "HELP — this list.",
    "Customers never see this Amber number.",
  ].join("\n")
}
