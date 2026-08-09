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
 * Public HTTPS URL for hold music (MP3/WAV).
 * Order: env LYNCR_HOLD_MUSIC_URL → legacy ZING_ → per-account override → app /audio/hold-music.mp3
 */
export function resolveHoldMusicUrl(accountOverride?: string | null): string | null {
  const fromAccount =
    typeof accountOverride === "string" && accountOverride.trim().startsWith("http")
      ? accountOverride.trim()
      : ""
  if (fromAccount) return fromAccount
  const fromEnv = envLyncrOrZing("HOLD_MUSIC_URL")
  if (fromEnv && fromEnv.startsWith("http")) return fromEnv
  // Documented default path — place a royalty-free MP3 at public/audio/hold-music.mp3
  // or set LYNCR_HOLD_MUSIC_URL. Without a reachable file, soft-hold still re-prompts via Speak.
  try {
    const base = getAppUrl().replace(/\/$/, "")
    if (base) return `${base}/audio/hold-music.mp3`
  } catch {
    /* getAppUrl may throw in unit tests without NEXT_PUBLIC_APP_URL */
  }
  return null
}

/** Short re-prompt while already on hold (press 1 anytime). */
export const HOLD_REPROMPT_DEFAULT =
  "Thanks for holding. Press 1 any time for a booking text, or stay on the line — we will connect you when someone is free."

/** Spoken when max wait is reached — offer SMS once, then hang up. */
export const HOLD_MAX_WAIT_SMS_PROMPT =
  "We are still tied up. We just texted you a booking link so you can grab the next open slot. Goodbye."

/** Soft Busy default — honest about hold + press 1 (Phase C copy soften). */
export const HOLD_AWARE_BUSY_PROMPT =
  "Thanks for calling. We're tied up right now. Press 1 for a booking text, or stay on the line and we will keep you updated."
