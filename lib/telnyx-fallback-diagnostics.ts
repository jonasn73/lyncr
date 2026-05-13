// ============================================
// Telnyx Dial `action` — optional diagnostic logging
// ============================================
// Set ZING_TELNYX_FALLBACK_DIAGNOSTIC=true on Vercel to log one JSON line per fallback
// request (PII-redacted). Use with fixtures in tests/ to match production behavior.

/** True when extended diagnostic JSON should be logged (in addition to `zing: telnyx-fallback`). */
export function isTelnyxFallbackDiagnosticEnabled(): boolean {
  const v = process.env.ZING_TELNYX_FALLBACK_DIAGNOSTIC
  return v === "1" || v === "true"
}

/** Redact runs of 7+ digits (E.164 chunks, DIDs) — keep last 4 for correlation. Short numbers unchanged. */
export function redactDigitsInString(value: string): string {
  return value.replace(/\d{7,}/g, (d) => `***${d.slice(-4)}`)
}

/** All form keys + redacted values for support / fixtures (never log raw E.164 at full length). */
export function redactDialCallbackFormFields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  formData.forEach((raw, key) => {
    const s = String(raw)
    out[key] = redactDigitsInString(s)
  })
  return out
}

/** Snapshot of routing decisions (safe to paste into a new fixture). */
export type TelnyxFallbackDiagnosticSnapshot = {
  userId: string
  callSid: string
  dialStatus: string
  rawDialStatus: string
  dialDurationSec: number
  bridgedToDigits: number
  answeredAndHadConversation: boolean
  pathFallbackMode: string | null
  virtualFbAi: boolean
  inboundFbIntent: string
  primaryWasOwner: boolean
  legHint: string
  businessLineResolved: string
  effectiveBusinessLine: string
  fallbackType: string
  useLive: boolean
  liveFallbackType: string | null
  configFallbackType: string | null
  globalFallbackType: string | null
  hasAssistantId: boolean
}

/**
 * First line per fallback request — proves Telnyx hit `/api/voice/telnyx/fallback/...`
 * (not the same as `/incoming`). Search Vercel for `telnyx-fallback-diagnostic` or filter Request by `fallback`.
 */
export function maybeLogTelnyxFallbackDiagnosticEntry(args: {
  pathname: string
  method: string
  pathUserId: string | null
  pathFallbackMode: string | null
  dialStatus: string
  rawDialStatus: string
  dialDurationSec: number
  bridgedToDigits: number
  bridgedSecHint?: number
  callSid: string
  virtualFbAi: boolean
  primaryWasOwner: boolean
  formData: FormData
}): void {
  if (!isTelnyxFallbackDiagnosticEnabled()) return
  console.log(
    JSON.stringify({
      zing: "telnyx-fallback-diagnostic",
      phase: "entry",
      pathname: args.pathname,
      method: args.method,
      pathUserId: args.pathUserId,
      pathFallbackMode: args.pathFallbackMode,
      dialStatus: args.dialStatus,
      rawDialStatus: args.rawDialStatus,
      dialDurationSec: args.dialDurationSec,
      bridgedToDigits: args.bridgedToDigits,
      bridgedSecHint: args.bridgedSecHint ?? null,
      callSid: args.callSid,
      virtualFbAi: args.virtualFbAi,
      primaryWasOwner: args.primaryWasOwner,
      formRedacted: redactDialCallbackFormFields(args.formData),
    })
  )
}

/** Log when we return before the full routing snapshot (hangup / error). */
export function maybeLogTelnyxFallbackDiagnosticEarly(
  reason: string,
  extra: Record<string, string | number | boolean | null>
): void {
  if (!isTelnyxFallbackDiagnosticEnabled()) return
  console.log(
    JSON.stringify({
      zing: "telnyx-fallback-diagnostic",
      phase: "early-exit",
      reason,
      ...extra,
    })
  )
}

/**
 * Logs a single JSON line: `zing: telnyx-fallback-diagnostic` when env is set.
 * Includes redacted form fields + decision snapshot so you can compare to tests/fixtures.
 */
export function maybeLogTelnyxFallbackDiagnostic(args: {
  requestUrl: string
  method: string
  formData: FormData
  snapshot: TelnyxFallbackDiagnosticSnapshot
}): void {
  if (!isTelnyxFallbackDiagnosticEnabled()) return
  const pathname = (() => {
    try {
      return new URL(args.requestUrl).pathname
    } catch {
      return args.requestUrl
    }
  })()
  console.log(
    JSON.stringify({
      zing: "telnyx-fallback-diagnostic",
      phase: "full",
      method: args.method,
      pathname,
      formRedacted: redactDialCallbackFormFields(args.formData),
      snapshot: {
        ...args.snapshot,
        businessLineResolved: redactDigitsInString(args.snapshot.businessLineResolved),
        effectiveBusinessLine: redactDigitsInString(args.snapshot.effectiveBusinessLine),
      },
    })
  )
}
