import type { PhoneNumberRoutingSummary } from "@/lib/types"

/** Teammate row shape used on the routing dashboard. */
export interface Contact {
  id: string
  name: string
  phone: string
  initials: string
  color: string
}

/** One business line on the dashboard — includes API `routing_summary` for AI confirmation. */
export interface DashboardBusinessNumber {
  number: string
  status: string
  routing_summary?: PhoneNumberRoutingSummary
}

export type FallbackOption = "owner" | "ai" | "voicemail"

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

export function formatPhoneDisplay(phone: string | undefined | null): string {
  if (phone == null || typeof phone !== "string") return "Your cell"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}
