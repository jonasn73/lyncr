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

/** How long one music segment plays before we re-speak Busy + gather (ms). */
export function holdRePromptIntervalMs(accountOverrideSecs?: number | null): number {
  const fromAccount =
    typeof accountOverrideSecs === "number" && Number.isFinite(accountOverrideSecs)
      ? Math.floor(accountOverrideSecs) * 1000
      : null
  const raw =
    fromAccount != null
      ? fromAccount
      : Number(envLyncrOrZing("HOLD_REPROMPT_MS") || "45000")
  if (!Number.isFinite(raw)) return 45_000
  // Keep between 20s and 90s so callers hear updates without thrashing Telnyx.
  return Math.min(90_000, Math.max(20_000, Math.floor(raw)))
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

/**
 * Public HTTPS URL for hold music (MP3/WAV).
 * Order: per-account override → env LYNCR_/ZING_HOLD_MUSIC_URL → bundled Calm default.
 */
export function resolveHoldMusicUrl(accountOverride?: string | null): string | null {
  if (typeof accountOverride === "string" && accountOverride.trim()) {
    const fromAccount = absoluteHoldMusicUrl(accountOverride)
    if (fromAccount) return fromAccount
  }
  const fromEnv = envLyncrOrZing("HOLD_MUSIC_URL")
  if (fromEnv) {
    const envUrl = absoluteHoldMusicUrl(fromEnv)
    if (envUrl) return envUrl
  }
  // Bundled royalty-free Calm loop — Busy stay-on-the-line is never silent when the app is hosted.
  try {
    const base = getAppUrl().replace(/\/$/, "")
    // Prefer hold-calm.wav (Calm preset); hold-music.wav is the same loop kept for legacy URLs.
    if (base) return `${base}/audio/hold-calm.wav`
  } catch {
    /* getAppUrl may throw in unit tests without NEXT_PUBLIC_APP_URL */
  }
  return null
}

/** Short re-prompt while already on hold (press 1 anytime). */
export const HOLD_REPROMPT_DEFAULT =
  "You're still in line. Thanks for holding. Press 1 any time for a booking text, or stay on the line — we will connect you when someone is free."

/** Spoken when max wait is reached — offer SMS once, then hang up. */
export const HOLD_MAX_WAIT_SMS_PROMPT =
  "We are still tied up. We just texted you a booking link so you can grab the next open slot. Goodbye."

/**
 * Soft Busy default — honest about hold + press 1.
 * Mentions the short booking form SMS so callers know what Press 1 does.
 * Do not overwrite custom Key Squad greetings in the DB — defaults only.
 */
export const HOLD_AWARE_BUSY_PROMPT =
  "Thanks for calling — we're tied up at the moment. Press 1 and we'll text you a short form to pick a time, or just stay on the line and we'll keep you updated."
