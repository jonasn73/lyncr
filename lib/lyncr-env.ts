// ============================================
// Lyncr env reads — LYNCR_* only
// ============================================
// This repo was renamed from the Zing project; env names, log keys, and a
// legacy session cookie carried the old name for a while. The ZING_* env var
// fallback has been fully retired — set LYNCR_* in Vercel.

/**
 * Read `LYNCR_<SUFFIX>`.
 * Example: envLyncr("HOLD_MUSIC_URL") → LYNCR_HOLD_MUSIC_URL
 */
export function envLyncr(suffix: string): string | undefined {
  // Normalize so callers can pass "HOLD_MUSIC_URL" or "LYNCR_HOLD_MUSIC_URL".
  const clean = String(suffix || "")
    .trim()
    .replace(/^LYNCR_/i, "")
  if (!clean) return undefined
  const value = process.env[`LYNCR_${clean}`]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

/** True when env value looks like an on-switch (1 / true / yes / on). */
export function envFlagOn(suffix: string, defaultOn = false): boolean {
  const raw = (envLyncr(suffix) ?? "").trim().toLowerCase()
  if (!raw) return defaultOn
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

/**
 * Structured voice / Call Control log line — use `lyncr:` (not legacy `zing:`).
 * Keeps Vercel log search consistent with the Lyncr brand.
 */
export function lyncrLog(event: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ lyncr: event, ...fields })
}
