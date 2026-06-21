// PIN / passcode correction helpers for wireless port exceptions.

import { validatePortingDeskPin, PORTING_PIN_FLEX_PATTERN } from "@/lib/porting-desk-validation"
import { looksLikePinPasscodeRejection } from "@/lib/telnyx-porting-webhook"
import type { PortingOrder } from "@/lib/types"

/** @deprecated Use PORTING_PIN_FLEX_PATTERN from porting-desk-validation */
export const PORTING_PIN_PATTERN = PORTING_PIN_FLEX_PATTERN

/** True when the owner entered a valid transfer PIN for this order's carrier rules. */
export function isValidPortingPin(pin: string, order?: PortingOrder): boolean {
  if (!order) return PORTING_PIN_FLEX_PATTERN.test(pin.trim())
  return validatePortingDeskPin(pin, order).ok
}

/** True when Telnyx / carrier flagged a missing or invalid wireless PIN. */
export function orderRequiresPinCorrection(order: PortingOrder): boolean {
  const reason = (order.carrier_rejection_reason ?? "").trim()
  if (!reason || !looksLikePinPasscodeRejection(reason)) return false
  if (order.status === "action_required" || order.status === "rejected") return true
  return (order.telnyx_status ?? "").toLowerCase().includes("exception")
}
