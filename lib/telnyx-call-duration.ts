// Parse talk-time seconds from Telnyx TeXML / status webhook form fields.

const DURATION_FIELD_KEYS = [
  "CallDuration",
  "call_duration",
  "Duration",
  "DialCallDuration",
  "DialCallDurationSeconds",
  "DialBridgedDuration",
  "DialDuration",
  "BridgeDuration",
  "BridgedDuration",
] as const

/** Normalize a raw duration string to whole seconds (Telnyx may send ms on some builds). */
export function normalizeTelnyxDurationSeconds(raw: string | null | undefined): number {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return 0
  let n = parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 600) n = Math.round(n / 1000)
  return n
}

/** Whole seconds from a Telnyx Voice API v2 JSON payload. */
export function parseTelnyxCallDurationFromPayload(payload: Record<string, unknown>): number {
  const fromField = normalizeTelnyxDurationSeconds(String(payload.call_duration ?? ""))
  if (fromField > 0) return fromField
  const start = String(payload.start_time ?? "").trim()
  const end = String(payload.end_time ?? "").trim()
  if (start && end) {
    const startMs = Date.parse(start)
    const endMs = Date.parse(end)
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return Math.round((endMs - startMs) / 1000)
    }
  }
  return 0
}

/** Best talk-time seconds from a Telnyx webhook form body. */
export function parseTelnyxTalkSecondsFromForm(formData: FormData): number {
  let best = 0
  for (const key of DURATION_FIELD_KEYS) {
    const value = formData.get(key)
    if (value == null) continue
    best = Math.max(best, normalizeTelnyxDurationSeconds(String(value)))
  }
  return best
}
