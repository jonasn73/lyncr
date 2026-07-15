// ============================================
// Public product identity (UI + metadata)
// ============================================
// Legacy env vars (ZING_*) and cookie `zing_session` stay for production compatibility;
// product branding is Lyncr everywhere else.

/** Official product name (lowercase in UI wordmark). */
export const SITE_NAME = "lyncr"

/** Logotype string — always lowercase in navbar and auth screens. */
export const SITE_WORDMARK = "lyncr"

/** One-line positioning for metadata and hero copy. */
export const SITE_TAGLINE = "Link every call to the right answer."

/**
 * Short narrative for help / onboarding (plain text; no HTML).
 */
export const SITE_BRAND_STORY =
  "lyncr keeps your published business number professional while routing rings behind the scenes—to you, your team, AI, or voicemail—without wrestling a phone system."

/** Default meta description for SEO and share cards. */
export const SITE_DESCRIPTION =
  "lyncr helps you buy or port a business number, route calls to your team or cell, and set voicemail, AI, or owner fallback—clear, calm, and always on."

/** Canonical site URL — used when NEXT_PUBLIC_APP_URL is unset. */
export const SITE_CANONICAL_URL = "https://lyncr.app"

/** Browser tab title template segment (after page title). */
export const SITE_TITLE_TEMPLATE_SUFFIX = SITE_NAME

/** Default full document title. */
export const SITE_METADATA_DEFAULT_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`

/** Prior spellings — SEO `alternateName` and legacy Telnyx object names. */
export const SITE_ALTERNATE_NAMES = ["HeySigo", "Hey Sigo", "Sigo", "Zing"] as const

export const SITE_KEYWORDS = [
  "lyncr",
  "business phone",
  "call routing",
  "virtual receptionist",
  "VoIP routing",
  "small business phone",
  "number porting",
  "AI phone assistant",
  "HeySigo",
] as const

/**
 * Rebrand guardrails for copy and UI.
 */
export const BRAND_GUIDE = {
  voice: "Warm, direct, and calm—like a trusted front desk, not a telecom manual.",
  promise: "One business number in public; flexible routing and fallbacks in private.",
  wordmark: "Always set in lowercase: lyncr.",
  look: "Deep ink background, soft violet–indigo signal, subtle warm highlight so the UI feels human and modern.",
} as const
