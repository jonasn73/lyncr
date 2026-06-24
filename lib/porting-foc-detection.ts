// Detect when a port order has a confirmed FOC (Firm Order Commitment) date.

import type { PortingOrder } from "@/lib/types"
import {
  collectPortingStatuses,
  normalizeTelnyxPortStatus,
  pickBestPortingStatus,
} from "@/lib/telnyx-porting-status"

const FOC_TELNYX_STATUSES = new Set([
  "foc-date-confirmed",
  "foc-date-confirmed-pending",
  "port-activating",
  "activation-in-progress",
])

/** Telnyx status string means a port date is assigned or activation is underway. */
export function telnyxStatusIndicatesFocScheduled(telnyxStatus: string | null | undefined): boolean {
  const normalized = normalizeTelnyxPortStatus(telnyxStatus ?? "")
  return FOC_TELNYX_STATUSES.has(normalized)
}

/** Carrier desk message confirms an FOC port date (e.g. "FOC Date: 06/25/2026"). */
export function carrierTextIndicatesFocConfirmed(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/foc\s+(rejected|expired|cancel)/i.test(trimmed)) return false
  if (/confirmed\s+foc\b/i.test(trimmed)) return true
  if (/\bfoc\s*date\s*:/i.test(trimmed)) return true
  if (/firm\s+order\s+commitment/i.test(trimmed) && /\bdate\b/i.test(trimmed)) return true
  return false
}

/** Live Telnyx order payload shows FOC scheduled via status or activation settings. */
export function telnyxLiveOrderIndicatesFocScheduled(live: Record<string, unknown>): boolean {
  const statuses = collectPortingStatuses(live)
  if (statuses.length > 0) {
    const best = normalizeTelnyxPortStatus(pickBestPortingStatus(statuses))
    if (FOC_TELNYX_STATUSES.has(best)) return true
  }

  const activation = live.activation_settings
  if (activation && typeof activation === "object" && !Array.isArray(activation)) {
    const settings = activation as Record<string, unknown>
    const confirmed = settings.foc_datetime_confirmed ?? settings.foc_datetime
    if (typeof confirmed === "string" && confirmed.trim()) return true
  }

  return false
}

/** True when the order row or carrier correspondence shows an FOC date is set. */
export function orderHasFocScheduled(order: PortingOrder, carrierTexts?: string[]): boolean {
  if (telnyxStatusIndicatesFocScheduled(order.telnyx_status)) return true
  if (carrierTexts?.some((text) => carrierTextIndicatesFocConfirmed(text))) return true
  return false
}
