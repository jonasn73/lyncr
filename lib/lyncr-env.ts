// ============================================
// Lyncr env reads — prefer LYNCR_*, fall back to legacy ZING_*
// ============================================
// Root cause of “zing keeps coming back”: this repo was renamed from the Zing
// project. Old env names (`ZING_*`), log keys (`zing:`), cookie `zing_session`,
// and copy-pasted comments still lived in Call Control / TeXML helpers.
// Always prefer LYNCR_* for new config. Dual-read keeps production working
// until Vercel env vars are renamed.

/**
 * Read `LYNCR_<SUFFIX>` first, then legacy `ZING_<SUFFIX>`.
 * Example: envLyncrOrZing("HOLD_MUSIC_URL") → LYNCR_HOLD_MUSIC_URL || ZING_HOLD_MUSIC_URL
 */
export function envLyncrOrZing(suffix: string): string | undefined {
  // Normalize so callers can pass "HOLD_MUSIC_URL" or "LYNCR_HOLD_MUSIC_URL".
  const clean = String(suffix || "")
    .trim()
    .replace(/^(LYNCR_|ZING_)/i, "")
  if (!clean) return undefined
  const lyncr = process.env[`LYNCR_${clean}`]
  if (typeof lyncr === "string" && lyncr.trim() !== "") return lyncr.trim()
  // Temporary fallback — remove once all Vercel envs are LYNCR_*.
  const zing = process.env[`ZING_${clean}`]
  if (typeof zing === "string" && zing.trim() !== "") return zing.trim()
  return undefined
}

/** True when env value looks like an on-switch (1 / true / yes / on). */
export function envFlagOn(suffix: string, defaultOn = false): boolean {
  const raw = (envLyncrOrZing(suffix) ?? "").trim().toLowerCase()
  if (!raw) return defaultOn
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

/** True when env value looks like an explicit off-switch. */
export function envFlagOff(suffix: string): boolean {
  const raw = (envLyncrOrZing(suffix) ?? "").trim().toLowerCase()
  return raw === "0" || raw === "false" || raw === "no" || raw === "off"
}

/**
 * Structured voice / Call Control log line — use `lyncr:` (not legacy `zing:`).
 * Keeps Vercel log search consistent with the Lyncr brand.
 */
export function lyncrLog(event: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ lyncr: event, ...fields })
}
