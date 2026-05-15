// ============================================
// Public product identity (UI + metadata)
// ============================================
// Env vars like ZING_ADMIN_EMAILS and cookie `zing_session` stay as-is for production compatibility.

/** Visible product name everywhere in the app shell and marketing. */
export const SITE_NAME = "Sigo"

/** Short positioning line (Spanish “sigo” ≈ I follow / I continue — routing follows you). */
export const SITE_TAGLINE = "Business calls that follow you."

/** Default meta description for SEO and share cards. */
export const SITE_DESCRIPTION =
  "Buy or port a business number, route calls to your team or cell, and set voicemail, AI, or owner fallback—so nothing falls through the cracks."

/** Canonical site URL (update when the domain moves off getzingapp.com). */
export const SITE_CANONICAL_URL = "https://www.getzingapp.com"

/** Browser tab title template segment (after page title). */
export const SITE_TITLE_TEMPLATE_SUFFIX = SITE_NAME

/** Default full document title. */
export const SITE_METADATA_DEFAULT_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`

export const SITE_KEYWORDS = [
  "business phone",
  "call routing",
  "virtual receptionist",
  "VoIP routing",
  "small business phone",
  "number porting",
  "AI phone assistant",
] as const
