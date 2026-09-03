/** Structured result when Telnyx cannot buy the exact reserved number — user must pick a replacement. */
type ProvisionLineFailureReason =
  | "number_unavailable"
  | "insufficient_credit"
  | "tier_limit"
  | "not_configured"
  | "carrier_error"

export type ProvisionLineResult =
  | { ok: true; phone_number: string; user_confirmed_number: boolean }
  | {
      ok: false
      error: string
      reason?: ProvisionLineFailureReason
      unavailable_number?: string
      area_code?: string
    }

/** Pull US area code from E.164 (+1XXXXXXXXXX). */
export function extractUsAreaCode(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4)
  if (digits.length >= 10) return digits.slice(0, 3)
  return ""
}
