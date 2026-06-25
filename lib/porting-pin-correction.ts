// PIN / passcode correction helpers for wireless port exceptions.

import {
  storedPortingPinForDesk,
  validatePortingDeskPin,
  PORTING_PIN_FLEX_PATTERN,
} from "@/lib/porting-desk-validation"
import { looksLikePinPasscodeRejection } from "@/lib/telnyx-porting-webhook"
import { normalizeTelnyxPortStatus } from "@/lib/telnyx-porting-status"
import type { PortingOrder } from "@/lib/types"

/** @deprecated Use PORTING_PIN_FLEX_PATTERN from porting-desk-validation */
export const PORTING_PIN_PATTERN = PORTING_PIN_FLEX_PATTERN

/** True when the owner entered a valid transfer PIN for this order's carrier rules. */
export function isValidPortingPin(pin: string, order?: PortingOrder): boolean {
  if (!order) return PORTING_PIN_FLEX_PATTERN.test(pin.trim())
  return validatePortingDeskPin(pin, order).ok
}

function correctionBlob(order: PortingOrder, conversationSnippets: string[] = []): string {
  return [order.carrier_rejection_reason ?? "", ...conversationSnippets].join(" ").trim()
}

/** True when Telnyx / carrier flagged a missing or invalid PIN (or live status is exception). */
export function orderRequiresPinCorrection(
  order: PortingOrder,
  conversationSnippets: string[] = []
): boolean {
  if (order.status === "completed") return false

  const telnyxKeyword = normalizeTelnyxPortStatus(order.telnyx_status ?? "")
  if (telnyxKeyword === "ported" || telnyxKeyword === "port-activating") return false

  const telnyx = (order.telnyx_status ?? "").toLowerCase()
  if (telnyx.includes("exception")) return true

  const reason = (order.carrier_rejection_reason ?? "").trim()
  if (reason && looksLikePinPasscodeRejection(reason)) return true

  const blob = correctionBlob(order, conversationSnippets)
  if (blob && looksLikePinPasscodeRejection(blob)) return true

  if (
    (order.status === "action_required" || order.status === "rejected") &&
    /transfer pin|porting pin|account number.*pin|pin.*account number/i.test(blob)
  ) {
    return true
  }

  return false
}

/** PIN already saved on the order while Telnyx is still re-reviewing an exception. */
export function orderPinSavedAwaitingCarrierReview(
  order: PortingOrder,
  conversationSnippets: string[] = []
): boolean {
  if (!storedPortingPinForDesk(order)) return false
  const telnyx = (order.telnyx_status ?? "").toLowerCase()
  if (!telnyx.includes("exception")) return false
  return orderRequiresPinCorrection(order, conversationSnippets)
}
