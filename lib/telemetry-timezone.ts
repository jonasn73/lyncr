// IANA timezone helpers for call HUD "today" / "this week" boundaries.

/** Default when the browser does not expose a timezone (US small-business fallback). */
export const DEFAULT_TELEMETRY_TIMEZONE = "America/New_York"

/** Allow only safe IANA timezone strings before passing them into SQL. */
export function sanitizeIanaTimezone(raw: string | null | undefined): string {
  const tz = String(raw ?? "").trim()
  if (/^[A-Za-z0-9_+\/-]+$/.test(tz) && tz.length >= 3 && tz.length <= 64) return tz
  return DEFAULT_TELEMETRY_TIMEZONE
}

/** Read the signed-in user's browser timezone for local "today" stats. */
export function resolveBrowserTimezone(): string {
  if (typeof Intl !== "undefined") {
    try {
      return sanitizeIanaTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TELEMETRY_TIMEZONE
}

/** Build `/api/routing/telemetry` query string with workspace + timezone. */
export function routingTelemetryQueryString(
  organizationId: string | null | undefined,
  timezone?: string | null
): string {
  const params = new URLSearchParams()
  const orgId = organizationId?.trim()
  if (orgId && !orgId.startsWith("legacy-")) {
    params.set("organization_id", orgId)
  }
  params.set("timezone", sanitizeIanaTimezone(timezone ?? resolveBrowserTimezone()))
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}
