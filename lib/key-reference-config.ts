// Key reference feature flags (safe to import from API routes and scripts).

/**
 * When true, never fetch fccid.io at runtime — bundled CSV + JSON cache only.
 * Defaults to ON so production/preview/dev avoid Cloudflare timeouts.
 * Set KEY_REFERENCE_CACHE_ONLY=false to allow live scraping (local tooling only).
 */
export function isKeyReferenceCacheOnly(): boolean {
  const raw = process.env.KEY_REFERENCE_CACHE_ONLY?.trim().toLowerCase()
  // Explicit opt-out only — unset / true / 1 / yes → cache-only.
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return true
}
