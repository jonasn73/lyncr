import type { PhoneNumberRoutingSummary } from "@/lib/types"

/** Lines shown in routing UI (includes trial checkout before Telnyx provision completes). */
export function isDashboardVisibleLineStatus(status: string): boolean {
  return status === "active" || status === "pending" || status === "porting"
}

/** Teammate row shape used on the routing dashboard. */
export interface Contact {
  id: string
  name: string
  phone: string
  initials: string
  color: string
  /** Receptionist portal Available toggle (`receptionists.is_active`). Default true when omitted. */
  is_active?: boolean
}

/** One business line on the dashboard — includes API `routing_summary` for AI confirmation. */
export interface DashboardBusinessNumber {
  number: string
  status: string
  label?: string
  organization_id?: string | null
  source_provider?: "telnyx" | "external"
  /** Per-line industry tag for skill-pool routing (`042`). */
  industry_tag?: string | null
  routing_summary?: PhoneNumberRoutingSummary
  /** Effective admin PSTN override for this line (line-level, else workspace-level). */
  admin_routing_override_phone?: string | null
  /** True when Telnyx owns the DID and voice routing is active. */
  carrier_live?: boolean
}

export type FallbackOption = "owner" | "ai" | "voicemail" | "hold"

/** Ring timeout options in the dashboard (seconds); must match Telnyx `<Dial timeout>` sensible range. */
export const DASHBOARD_RING_TIMEOUT_CHOICES = [10, 12, 15, 20, 25, 30, 35, 40, 45, 60] as const

export function snapDashboardRingTimeoutSec(sec: number): (typeof DASHBOARD_RING_TIMEOUT_CHOICES)[number] {
  const clamped = Math.min(90, Math.max(10, Math.round(sec)))
  let best: (typeof DASHBOARD_RING_TIMEOUT_CHOICES)[number] = DASHBOARD_RING_TIMEOUT_CHOICES[0]
  let bestD = Infinity
  for (const n of DASHBOARD_RING_TIMEOUT_CHOICES) {
    const d = Math.abs(n - clamped)
    if (d < bestD) {
      best = n
      bestD = d
    }
  }
  return best
}

/** Last 10 US digits so we can match +1… vs 10-digit values from APIs without breaking line selection. */
export function phoneDigits10(phone: string | null | undefined): string {
  if (phone == null || typeof phone !== "string") return ""
  const d = phone.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return d.slice(-10)
  if (d.length >= 10) return d.slice(-10)
  return d
}

/** True when two stored phone strings refer to the same DID (handles +1 vs digits-only). */
export function businessNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return phoneDigits10(a) === phoneDigits10(b)
}

/** Format E.164 to display, e.g. +15025551234 -> (502) 555-1234 */
/** Short line state for the Step 1 picker (selected line vs other routable lines). */
export function linePickerStatusLabel(isSelectedLine: boolean): "Active" | "Routed" {
  return isSelectedLine ? "Active" : "Routed"
}

/** Pretty US phone for UI — empty / incomplete never becomes `()` or `(   )`. */
export function formatPhoneDisplay(phone: string | undefined | null): string {
  // Missing value — show nothing until a real number is ready (avoids refresh flash).
  if (phone == null || typeof phone !== "string") return ""
  // Strip whitespace so "   " and "()" don't leak into the call-flow detail line.
  const trimmed = phone.trim()
  if (!trimmed) return ""
  // Keep digits only so we can decide if the number is complete enough to format.
  const digits = trimmed.replace(/\D/g, "")
  // Punctuation-only / empty-digit strings (e.g. "()") — never render bare parentheses.
  if (digits.length === 0) return ""
  // Standard 10-digit NANP → (555) 123-4567.
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  // 11-digit with leading 1 → same pretty form without the country code.
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  // Incomplete or non-US — show the raw trimmed value, not a fake empty mask.
  return trimmed
}
