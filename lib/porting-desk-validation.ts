// Front-end + API validation for Carrier Transfer Desk corrections (prevents Telnyx lockouts).

import { isWirelessPortingContext } from "@/lib/porting-carrier-exceptions"
import type { PortingOrder } from "@/lib/types"

/** Standard wireless / mobile transfer PIN (4–8 digits). */
export const PORTING_PIN_FLEX_PATTERN = /^\d{4,8}$/

/** Some carriers (e.g. major wireless) require exactly 8 digits. */
export const PORTING_PIN_EIGHT_DIGIT_PATTERN = /^\d{8}$/

/** Reply text — printable ASCII, no control chars Telnyx regex rejects. */
export const PORTING_DESK_MESSAGE_PATTERN = /^[\x20-\x7E\n\r\t]{1,8000}$/

export type PortingDeskValidationResult =
  | { ok: true }
  | { ok: false; field: "pin" | "message"; message: string }

export function requiresExactEightDigitWirelessPin(order: PortingOrder): boolean {
  const wireless = isWirelessPortingContext({
    current_carrier: order.current_carrier,
    carrier_rejection_reason: order.carrier_rejection_reason,
  })
  return (
    wireless && /8.?digit|eight.?digit|exactly 8/i.test(order.carrier_rejection_reason ?? "")
  )
}

/** Pick PIN regex from carrier context (wireless → strict 8-digit when flagged). */
export function portingPinPatternForOrder(order: PortingOrder): RegExp {
  if (requiresExactEightDigitWirelessPin(order)) return PORTING_PIN_EIGHT_DIGIT_PATTERN
  return PORTING_PIN_FLEX_PATTERN
}

/**
 * Value safe to show in the PIN field — ignores account SIDs, hashes, and other
 * non-PIN data stored in porting_orders.pin_or_sid.
 */
export function storedPortingPinForDesk(order: PortingOrder): string {
  const stored = (order.pin_or_sid ?? "").trim()
  if (!stored) return ""
  const pattern = portingPinPatternForOrder(order)
  if (pattern.test(stored)) return stored
  if (PORTING_PIN_FLEX_PATTERN.test(stored)) return stored
  return ""
}

export function validatePortingDeskPin(pin: string, order: PortingOrder): PortingDeskValidationResult {
  const trimmed = pin.trim()
  if (!trimmed) {
    return { ok: false, field: "pin", message: "Enter your transfer PIN before submitting to the carrier." }
  }
  const pattern = portingPinPatternForOrder(order)
  if (!pattern.test(trimmed)) {
    if (requiresExactEightDigitWirelessPin(order)) {
      return {
        ok: false,
        field: "pin",
        message: "This carrier requires an exactly 8-digit wireless transfer PIN.",
      }
    }
    return {
      ok: false,
      field: "pin",
      message: "Transfer PIN must be 4–8 digits (numbers only, no spaces).",
    }
  }
  return { ok: true }
}

export function validatePortingDeskMessage(message: string): PortingDeskValidationResult {
  const trimmed = message.trim()
  if (!trimmed) {
    return { ok: false, field: "message", message: "Enter a reply for the carrier desk." }
  }
  if (!PORTING_DESK_MESSAGE_PATTERN.test(trimmed)) {
    return {
      ok: false,
      field: "message",
      message: "Message contains characters the carrier API rejects — use plain text only.",
    }
  }
  return { ok: true }
}

export function validatePortingDeskSubmission(params: {
  order: PortingOrder
  pinRequired: boolean
  pin: string
  message: string
}): PortingDeskValidationResult {
  if (params.pinRequired) {
    return validatePortingDeskPin(params.pin, params.order)
  }
  const pinTrimmed = params.pin.trim()
  if (pinTrimmed) {
    const pinCheck = validatePortingDeskPin(pinTrimmed, params.order)
    if (!pinCheck.ok) return pinCheck
  }
  const msgTrimmed = params.message.trim()
  if (!msgTrimmed && !pinTrimmed) {
    return {
      ok: false,
      field: "message",
      message: "Add a reply or corrected PIN before submitting.",
    }
  }
  if (msgTrimmed) {
    return validatePortingDeskMessage(msgTrimmed)
  }
  return { ok: true }
}
