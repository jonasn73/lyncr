// ============================================
// Hold queue config — Busy “stay on the line” Call Control
// ============================================
// Phase A: soft hold (music + re-prompt). Phase B: Telnyx enqueue + Lines Answer.
// Naming is Lyncr-only — never introduce LYNCR_HOLD_* vars.

import { envLyncr } from "@/lib/lyncr-env"
import { getAppUrl } from "@/lib/telnyx"

/** Telnyx queue name per account — bridge { queue } takes the head of this queue. */
export function lyncrHoldQueueName(userId: string): string {
  const id = String(userId || "").trim()
  return `lyncr-${id || "unknown"}`
}

/** How long one music segment plays before a short “still in line” reminder (ms). */
export function holdRePromptIntervalMs(accountOverrideSecs?: number | null): number {
  const fromAccount =
    typeof accountOverrideSecs === "number" && Number.isFinite(accountOverrideSecs)
      ? Math.floor(accountOverrideSecs) * 1000
      : null
  const raw =
    fromAccount != null
      ? fromAccount
      : Number(envLyncr("HOLD_REPROMPT_MS") || "60000")
  if (!Number.isFinite(raw)) return 60_000
  // Call-center feel: 45–90s between short reminders (not constant talking).
  return Math.min(90_000, Math.max(45_000, Math.floor(raw)))
}

/**
 * The very first hold segment uses this instead of holdRePromptIntervalMs — the Phase-1
 * industry question (lib/hold-queue-intake-prompts.ts) is worth asking early, while the
 * caller is still fresh, not after a full 45–90s of unbroken music. Later cycles fall back
 * to the account's normal cadence unchanged.
 */
export const HOLD_FIRST_REPROMPT_MS = 18_000

/**
 * Minimum time a caller must have already waited before the "caller answered your
 * questions" owner SMS fires (lib/hold-intake-captured-alert.ts) — even if intake is
 * captured almost immediately, the owner doesn't get texted about a call that might be
 * answered from Lines within a few seconds anyway. Deliberately separate from (much
 * shorter than) holdLongWaitAlertMs, which is about wait-time pain, not lead quality.
 */
export const HOLD_INTAKE_CAPTURED_ALERT_MIN_WAIT_MS = 60_000

/** Max time a caller may wait in the hold queue (seconds) before one SMS + hangup. */
export function holdMaxWaitSecs(accountOverrideSecs?: number | null): number {
  const fromAccount =
    typeof accountOverrideSecs === "number" && Number.isFinite(accountOverrideSecs)
      ? Math.floor(accountOverrideSecs)
      : null
  const raw =
    fromAccount != null
      ? fromAccount
      : Number(envLyncr("HOLD_MAX_WAIT_SECS") || "600")
  if (!Number.isFinite(raw)) return 600
  // 2–15 minutes — long enough for Answer from Lines, short enough for carrier spend.
  return Math.min(900, Math.max(120, Math.floor(raw)))
}

/**
 * Elapsed hold time (ms) at which the owner gets a one-time "someone's really
 * waiting" heads-up text — halfway through the account's own max wait, so it
 * always lands before the max-wait SMS+hangup, whatever that account has set.
 */
export function holdLongWaitAlertMs(accountOverrideSecs?: number | null): number {
  const maxWaitMs = holdMaxWaitSecs(accountOverrideSecs) * 1000
  return Math.max(60_000, Math.floor(maxWaitMs / 2))
}

/** Cap concurrent waiting holds per account (orphan / minute protection). */
export function holdMaxConcurrent(): number {
  const raw = Number(envLyncr("HOLD_MAX_CONCURRENT") || "3")
  if (!Number.isFinite(raw)) return 3
  return Math.min(10, Math.max(1, Math.floor(raw)))
}

/**
 * Turn a stored account hold-music value into a public HTTPS play URL.
 * Accepts full https://… or portable /audio/… paths from presets.
 */
function absoluteHoldMusicUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  if (value.startsWith("/audio/")) {
    try {
      const base = getAppUrl().replace(/\/$/, "")
      if (base) return `${base}${value}`
    } catch {
      /* unit tests may lack NEXT_PUBLIC_APP_URL */
    }
  }
  return null
}

/** Bundled Calm loop — 8 kHz mono WAV (Telnyx PSTN-safe). */
export const HOLD_MUSIC_DEFAULT_PATH = "/audio/hold-calm.wav"

/**
 * Optional Telnyx Media Storage name (Mission Control → Media, or POST /v2/media).
 * When set, Call Control plays by `media_name` (no URL fetch from Telnyx → lyncr.app).
 */
export function holdMusicMediaName(): string | null {
  const raw = (envLyncr("HOLD_MUSIC_MEDIA_NAME") || "").trim()
  return raw || null
}

/**
 * Public HTTPS URL for hold music (WAV preferred).
 * Order: per-account override → env LYNCR_/LYNCR_HOLD_MUSIC_URL → bundled Calm WAV.
 */
export function resolveHoldMusicUrl(accountOverride?: string | null): string | null {
  const candidates = resolveHoldMusicUrlCandidates(accountOverride)
  return candidates[0] ?? null
}

/**
 * Ordered list of music URLs to try (preset/custom → twin → public fallback).
 * Callers should attempt playback in order until Telnyx accepts one.
 */
export function resolveHoldMusicUrlCandidates(accountOverride?: string | null): string[] {
  const out: string[] = []
  const push = (url: string | null | undefined) => {
    const u = typeof url === "string" ? url.trim() : ""
    if (u && !out.includes(u)) out.push(u)
  }

  if (typeof accountOverride === "string" && accountOverride.trim()) {
    push(absoluteHoldMusicUrl(accountOverride))
    // If account stored .mp3, also try the sibling .wav (and vice versa).
    const abs = absoluteHoldMusicUrl(accountOverride)
    if (abs?.endsWith(".mp3")) push(abs.replace(/\.mp3$/i, ".wav"))
    if (abs?.endsWith(".wav")) push(abs.replace(/\.wav$/i, ".mp3"))
  }

  const fromEnv = envLyncr("HOLD_MUSIC_URL")
  if (fromEnv) {
    push(absoluteHoldMusicUrl(fromEnv))
    const envAbs = absoluteHoldMusicUrl(fromEnv)
    if (envAbs?.endsWith(".mp3")) push(envAbs.replace(/\.mp3$/i, ".wav"))
    if (envAbs?.endsWith(".wav")) push(envAbs.replace(/\.wav$/i, ".mp3"))
  }

  // Bundled classic-hold WAV (default) + legacy alias — WAV only (PSTN-safe).
  try {
    const base = getAppUrl().replace(/\/$/, "")
    if (base) {
      push(`${base}${HOLD_MUSIC_DEFAULT_PATH}`)
      push(`${base}/audio/hold-music.wav`)
    }
  } catch {
    /* getAppUrl may throw in unit tests without NEXT_PUBLIC_APP_URL */
  }

  return out
}

/**
 * Short hold reminder — same idea every time (call-center style).
 * Do NOT swap in a different full Busy greeting mid-hold.
 */
export const HOLD_REPROMPT_DEFAULT =
  "You're still in line. Press 1 to book by text, or stay on the line."

/**
 * Same reminder, for a caller who's already fully answered the smart-hold intake
 * questions — acknowledges that instead of repeating the exact same "please answer"
 * framing to someone who's already engaged and told us what they need. Only once intake
 * is done do we offer a callback (press 2) — asking earlier would promise a callback
 * before we actually know what it's for.
 */
export const HOLD_REPROMPT_ALREADY_ANSWERED =
  "Thanks for those details — you're still in line. Press 1 to book by text, " +
  "press 2 if you'd rather we call you back, or stay on the line."

/**
 * Same reminder, for a caller we already have real details on file for (any existing
 * booking/customer record — a returning customer calling back, not necessarily someone
 * who just answered on hold this session) — skips the intake questions outright rather
 * than re-collecting what's already known, without falsely thanking them for "details"
 * they didn't just give us on THIS call. Deliberately says "a text" rather than "book by
 * text" here — requested directly: someone who's already booked shouldn't be told to
 * book, which read as the system not knowing who they are.
 */
export const HOLD_REPROMPT_KNOWN_CUSTOMER =
  "Our team members are still tied up right now. Press 1 for a text, " +
  "press 2 if you'd rather we call you back, or stay on the line."

/**
 * Asked once, on the first reprompt cycle, when we have a specific vehicle on file for this
 * caller (customer_vehicles, most recently updated) — instead of any "we recognize you"
 * framing. Requested directly: recognition should only ever change internal routing, never
 * be spoken — no "welcome back", no acknowledging we know who they are. This reads like an
 * ordinary targeted question, not a callback: "If you're calling about your 2016 Chrysler
 * 200, press 1. If not, press 2."
 */
export function holdVehicleConfirmPrompt(vehicleDescription: string): string {
  return `If you're calling about your ${vehicleDescription}, press 1. If not, press 2.`
}

/** After confirming it's the same vehicle — find out if there's anything new to relay. */
export const HOLD_VEHICLE_CHANGED_PROMPT =
  "Has anything changed since we last spoke? Press 1 if something's different, " +
  "or press 2 if it's the same."

/**
 * "Nothing's changed" branch of the vehicle-confirm flow — they almost certainly just want
 * a status check, not a fresh intake. Skips straight to the wait-or-callback offer, no
 * re-asking of any question, and no "press 1 to book by text" (there's nothing new to send).
 */
export const HOLD_VEHICLE_NO_CHANGE_REPROMPT =
  "Our team members are still tied up right now. Stay on the line, or press 2 for a callback."

/**
 * "2016 Chrysler 200" style descriptor for the vehicle-confirm prompt above — year is
 * optional (a bare "Chrysler 200" still reads naturally), make/model are not: without at
 * least those two this returns "" and the caller falls back to the generic reprompt tiers.
 */
export function describeVehicleForSpeech(v: {
  year?: string | null
  make?: string | null
  model?: string | null
}): string {
  const year = String(v.year ?? "").trim()
  const make = String(v.make ?? "").trim()
  const model = String(v.model ?? "").trim()
  if (!make || !model) return ""
  const parts = [year, make, model].filter(Boolean)
  const out = parts.join(" ")
  return out.length > 60 ? "" : out
}

/** Spoken when max wait is reached — offer SMS once, then hang up. */
export const HOLD_MAX_WAIT_SMS_PROMPT =
  "We are still tied up. We just texted you a booking link so you can tell us when you need us. Goodbye."

/**
 * Soft Busy default — honest about hold + press 1.
 * Mentions the short booking form SMS so callers know what Press 1 does.
 * Do not overwrite custom Key Squad greetings in the DB — defaults only.
 */
export const HOLD_AWARE_BUSY_PROMPT =
  "Thanks for calling — we're tied up at the moment. Press 1 and we'll text you a short form to tell us when you need us, or just stay on the line and we'll keep you updated."

/** Reject placeholder/blank values that should never be read aloud as a customer's name. */
const PLACEHOLDER_CALLER_NAMES = new Set(["unknown caller", "unknown", "customer", "n/a", "—", "-"])

/**
 * Light TTS sanity check on a saved customer display_name — non-empty, plausible length,
 * not a known placeholder. Free-text from an operator, never trust it blindly for Speak.
 */
export function sanitizeCallerNameForSpeech(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed || trimmed.length > 40) return ""
  if (PLACEHOLDER_CALLER_NAMES.has(trimmed.toLowerCase())) return ""
  return trimmed
}

/**
 * Shared "who is this" prefix — used by the initial Busy greeting and the booking-SMS
 * confirmation (single-shot moments). Deliberately NOT used on every hold reprompt cycle —
 * repeating a name every ~20s during a long hold reads as over-personalized rather than warm.
 * Repeat-caller status is tracked for internal signals (urgency, receptionist context) but
 * deliberately never spoken to the caller — requested directly, it read as unnecessary.
 */
export function callerGreetingPrefix(opts: { callerDisplayName?: string | null }): string {
  const name = sanitizeCallerNameForSpeech(opts.callerDisplayName)
  return name ? `Hey ${name} — ` : ""
}
