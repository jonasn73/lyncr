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
  "lyncr is software for small service businesses—business phone and call routing, dispatch and CRM, plus payments—so every call reaches the right person and every job stays on track."

/** Default meta description for SEO, share cards, and Stripe reviewers. */
export const SITE_DESCRIPTION =
  "lyncr is B2B software for locksmiths, mobile techs, and similar service businesses: business phone and call routing, dispatch, scheduler, CRM, and payments (Tap to Pay and pay links via Stripe Connect)."

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
  "field service software",
  "dispatch software",
  "service business CRM",
  "Tap to Pay",
  "Stripe Connect",
  "locksmith software",
  "mobile technician app",
  "virtual receptionist",
  "VoIP routing",
  "number porting",
] as const
