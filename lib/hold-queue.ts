// ============================================
// Hold queue config — Busy “stay on the line” Call Control
// ============================================
// Phase A: soft hold (music + re-prompt). Phase B: Telnyx enqueue + Lines Answer.
// Naming is Lyncr-only — never introduce ZING_HOLD_* vars.

import { envLyncrOrZing } from "@/lib/lyncr-env"
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
      : Number(envLyncrOrZing("HOLD_REPROMPT_MS") || "60000")
  if (!Number.isFinite(raw)) return 60_000
  // Call-center feel: 45–90s between short reminders (not constant talking).
  return Math.min(90_000, Math.max(45_000, Math.floor(raw)))
}

/** Max time a caller may wait in the hold queue (seconds) before one SMS + hangup. */
export function holdMaxWaitSecs(accountOverrideSecs?: number | null): number {
  const fromAccount =
    typeof accountOverrideSecs === "number" && Number.isFinite(accountOverrideSecs)
      ? Math.floor(accountOverrideSecs)
      : null
  const raw =
    fromAccount != null
      ? fromAccount
      : Number(envLyncrOrZing("HOLD_MAX_WAIT_SECS") || "600")
  if (!Number.isFinite(raw)) return 600
  // 2–15 minutes — long enough for Answer from Lines, short enough for carrier spend.
  return Math.min(900, Math.max(120, Math.floor(raw)))
}

/** Cap concurrent waiting holds per account (orphan / minute protection). */
export function holdMaxConcurrent(): number {
  const raw = Number(envLyncrOrZing("HOLD_MAX_CONCURRENT") || "3")
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
  const raw = (envLyncrOrZing("HOLD_MUSIC_MEDIA_NAME") || "").trim()
  return raw || null
}

/**
 * Public HTTPS URL for hold music (WAV preferred).
 * Order: per-account override → env LYNCR_/ZING_HOLD_MUSIC_URL → bundled Calm WAV.
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

  const fromEnv = envLyncrOrZing("HOLD_MUSIC_URL")
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
 * Shared "who is this / have we heard from them today" prefix — used by the initial Busy
 * greeting and the booking-SMS confirmation (single-shot moments). Deliberately NOT used on
 * every hold reprompt cycle — repeating a name every ~20s during a long hold reads as
 * over-personalized rather than warm.
 */
export function callerGreetingPrefix(opts: {
  callerDisplayName?: string | null
  isRepeatCaller?: boolean
}): string {
  const name = sanitizeCallerNameForSpeech(opts.callerDisplayName)
  if (name && opts.isRepeatCaller) return `Hey ${name}, thanks for trying us again — `
  if (name) return `Hey ${name} — `
  if (opts.isRepeatCaller) return "Thanks for trying us again — "
  return ""
}
