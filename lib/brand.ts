// ============================================
// Public product identity (UI + metadata)
// ============================================
// Env vars like ZING_ADMIN_EMAILS and cookie `zing_session` stay as-is for production compatibility.

/** Official product string — one word, camel-style caps (HeySigo). */
export const SITE_NAME = "HeySigo"

/**
 * One-line positioning: greeting + routing that follows the business (sigo ≈ I follow / I continue).
 */
export const SITE_TAGLINE = "Say hey—your business line follows you."

/**
 * Short narrative for help / onboarding (plain text; no HTML). Reinforces one-word brand + calm ops story.
 */
export const SITE_BRAND_STORY =
  "HeySigo is one word on purpose: a quick hello, then steady follow-through for every ring. Your published number stays professional while we route behind the scenes—to you, your team, AI, or voicemail—without you wrestling a phone system."

/** Default meta description for SEO and share cards. */
export const SITE_DESCRIPTION =
  "HeySigo helps you buy or port a business number, route calls to your team or cell, and set voicemail, AI, or owner fallback—clear, calm, and always on."

/** Canonical site URL (update when the domain moves off getzingapp.com). */
export const SITE_CANONICAL_URL = "https://www.getzingapp.com"

/** Browser tab title template segment (after page title). */
export const SITE_TITLE_TEMPLATE_SUFFIX = SITE_NAME

/** Default full document title. */
export const SITE_METADATA_DEFAULT_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`

/** Prior spellings / code names — SEO `alternateName` and legacy Telnyx object names. */
export const SITE_ALTERNATE_NAMES = ["Hey Sigo", "Sigo", "Zing"] as const

export const SITE_KEYWORDS = [
  "HeySigo",
  "Hey Sigo",
  "Sigo",
  "business phone",
  "call routing",
  "virtual receptionist",
  "VoIP routing",
  "small business phone",
  "number porting",
  "AI phone assistant",
] as const

/**
 * Rebrand guardrails for copy and UI (logotype: thin Hey + bold Sigo = one word HeySigo).
 */
export const BRAND_GUIDE = {
  voice: "Warm, direct, and calm—like a trusted front desk, not a telecom manual.",
  promise: "One business number in public; flexible routing and fallbacks in private.",
  wordmark: "Light weight on “Hey”, bold “Sigo”; together they read as HeySigo without a space.",
  look: "Deep ink background, soft violet–indigo signal, subtle warm highlight so the UI feels human and modern.",
} as const
