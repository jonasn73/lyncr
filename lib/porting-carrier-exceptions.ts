// Extract losing-carrier exception details from Telnyx porting webhook / order payloads.

import { cleansePortingHumanComment } from "@/lib/porting-display"
import { extractPortingOrderRecord } from "@/lib/telnyx-porting-webhook"

/** One structured carrier requirement pulled from exceptions / errors / status.details. */
export type PortingCarrierRequirement = {
  losing_carrier_name: string | null
  exception_text: string
}

const LOSING_CARRIER_KEYS = [
  "old_service_provider_ocn",
  "losing_carrier_name",
  "losing_carrier",
  "carrier_name",
  "service_provider_name",
  "service_provider",
  "sp_name",
] as const

const EXCEPTION_CODE_LABELS: Record<string, string> = {
  PASSCODE_PIN_INVALID: "Passcode/pin must be provided for wireless port.",
  ACCOUNT_NUMBER_MISMATCH: "Account number does not match losing carrier records.",
  ENTITY_NAME_MISMATCH: "Business name does not match losing carrier records.",
  BTN_ATN_MISMATCH: "Billing telephone number does not match losing carrier records.",
  PHONE_NUMBER_MISMATCH: "Phone number does not match losing carrier records.",
  LOCATION_MISMATCH: "Service address does not match losing carrier records.",
  POSTAL_CODE_MISMATCH: "Postal code does not match losing carrier records.",
  PHONE_NUMBER_NOT_PORTABLE: "Phone number cannot be ported from this carrier.",
  PORT_TYPE_INCORRECT: "Port type does not match the losing carrier line type.",
  FOC_REJECTED: "Port date was rejected by the losing carrier.",
  FOC_EXPIRED: "Port date expired — a new date is required.",
  OSP_IRRESPONSIVE: "Losing carrier has not responded yet.",
  OTHER: "Additional information is required by the losing carrier.",
}

function humanizeExceptionCode(code: string): string {
  const upper = code.trim().toUpperCase().replace(/-/g, "_")
  if (EXCEPTION_CODE_LABELS[upper]) return EXCEPTION_CODE_LABELS[upper]
  return code.replace(/_/g, " ").trim().toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function textFromExceptionItem(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) return item.trim()
  if (!item || typeof item !== "object" || Array.isArray(item)) return null
  const row = item as Record<string, unknown>
  for (const key of ["description", "message", "detail", "error", "text", "reason"]) {
    const value = row[key]
    if (typeof value === "string" && value.trim().length > 3) return value.trim()
  }
  if (typeof row.code === "string" && row.code.trim()) return humanizeExceptionCode(row.code)
  if (typeof row.title === "string" && row.title.trim().length > 3) return row.title.trim()
  return null
}

function readCarrierNameFromObject(obj: Record<string, unknown>): string | null {
  for (const key of LOSING_CARRIER_KEYS) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  const nested = obj.losing_carrier
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const name =
      (nested as Record<string, unknown>).name ??
      (nested as Record<string, unknown>).carrier_name ??
      (nested as Record<string, unknown>).entity_name
    if (typeof name === "string" && name.trim()) return name.trim()
  }
  return null
}

function deepFindCarrierName(obj: unknown, depth = 0): string | null {
  if (depth > 14 || obj == null) return null
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const direct = readCarrierNameFromObject(obj as Record<string, unknown>)
    if (direct) return direct
    for (const value of Object.values(obj as Record<string, unknown>)) {
      const found = deepFindCarrierName(value, depth + 1)
      if (found) return found
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindCarrierName(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

function collectExceptionTextsFromObject(obj: Record<string, unknown>, out: string[]): void {
  const pos = obj.porting_order_status
  if (pos && typeof pos === "object" && !Array.isArray(pos)) {
    const details = (pos as Record<string, unknown>).details
    if (Array.isArray(details)) {
      for (const item of details) {
        const text = textFromExceptionItem(item)
        if (text) out.push(text)
      }
    }
  }
  const arrays = [
    obj.exceptions,
    obj.errors,
    (obj.porting_order_status as Record<string, unknown> | undefined)?.details,
    (obj.status as Record<string, unknown> | undefined)?.details,
    obj.details,
  ]
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      const text = textFromExceptionItem(item)
      if (text) out.push(text)
    }
  }
  const phones = obj.phone_numbers
  if (Array.isArray(phones)) {
    for (const phone of phones) {
      if (!phone || typeof phone !== "object") continue
      collectExceptionTextsFromObject(phone as Record<string, unknown>, out)
    }
  }
}

function deepCollectExceptionTexts(obj: unknown, out: string[], depth = 0): void {
  if (depth > 14 || obj == null) return
  if (typeof obj === "object" && !Array.isArray(obj)) {
    collectExceptionTextsFromObject(obj as Record<string, unknown>, out)
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepCollectExceptionTexts(value, out, depth + 1)
    }
    return
  }
  if (Array.isArray(obj)) {
    for (const item of obj) deepCollectExceptionTexts(item, out, depth + 1)
  }
}

/** True when payload includes structured exceptions/errors/status.details (not just a comment). */
export function hasPortingCarrierExceptions(body: Record<string, unknown>): boolean {
  return collectPortingExceptionTexts(body).length > 0
}

/** All exception strings found in the payload (deduped). */
export function collectPortingExceptionTexts(body: Record<string, unknown>): string[] {
  const out: string[] = []
  deepCollectExceptionTexts(body, out)
  const unique = [...new Set(out.map((t) => t.trim()).filter(Boolean))]
  return unique.map((text) => cleansePortingHumanComment(text) || text)
}

/** Losing carrier entity name from Telnyx payload (e.g. ONVOY, LLC - KY). */
export function extractLosingCarrierName(body: Record<string, unknown>): string | null {
  const record = extractPortingOrderRecord(body)
  if (record) {
    const fromRecord = readCarrierNameFromObject(record)
    if (fromRecord) return fromRecord
  }
  return deepFindCarrierName(body)
}

function pickPrimaryExceptionText(texts: string[]): string | null {
  if (texts.length === 0) return null
  const pinRelated = texts.find((t) => /pin|passcode|wireless port/i.test(t))
  if (pinRelated) return pinRelated
  return texts[0]
}

/** Format persisted log line for carrier desk exceptions. */
export function formatLosingCarrierRequirement(
  carrierName: string | null,
  exceptionText: string
): string {
  const carrier = carrierName?.trim() || "Unknown"
  const cleaned = (cleansePortingHumanComment(exceptionText) || exceptionText).trim().replace(/\.$/, "")
  return `Losing Carrier ${carrier} requiring: ${cleaned}.`
}

/** Best structured carrier requirement from a Telnyx porting payload. */
export function extractPortingCarrierRequirement(
  body: Record<string, unknown>
): PortingCarrierRequirement | null {
  const exceptionTexts = collectPortingExceptionTexts(body)
  const exceptionText = pickPrimaryExceptionText(exceptionTexts)
  if (!exceptionText) return null
  return {
    losing_carrier_name: extractLosingCarrierName(body),
    exception_text: exceptionText,
  }
}

/** Notification body when exceptions/errors are present in the webhook payload. */
export function extractPortingCarrierRequirementLogBody(body: Record<string, unknown>): string | null {
  const requirement = extractPortingCarrierRequirement(body)
  if (!requirement) return null
  return formatLosingCarrierRequirement(requirement.losing_carrier_name, requirement.exception_text)
}

/** Centered systemic feed line for Telnyx `exception` / sub-request failures. */
export function formatPortingExceptionSystemMessage(exceptionText: string): string {
  const cleaned = (cleansePortingHumanComment(exceptionText) || exceptionText).trim().replace(/\.$/, "")
  return `🔴 Carrier Rejected Correction: ${cleaned}.`
}

/** Detect wireless/mobile port context for PIN helper tips. */
export function isWirelessPortingContext(params: {
  current_carrier?: string | null
  carrier_rejection_reason?: string | null
  telnyx_phone_number_type?: string | null
  conversation_snippets?: string[]
}): boolean {
  const carrier = (params.current_carrier ?? "").toLowerCase()
  const majorMobile =
    /verizon|at&t|att|t-mobile|tmobile|sprint|us cellular|metro|cricket|boost|onvoy|wireless|mobile/i
  if (majorMobile.test(carrier)) return true
  if ((params.telnyx_phone_number_type ?? "").toLowerCase() === "mobile") return true
  const blob = [
    params.carrier_rejection_reason ?? "",
    ...(params.conversation_snippets ?? []),
  ]
    .join(" ")
    .toLowerCase()
  return /wireless port|mobile port|passcode|pass code|account pin|transfer pin|pin must be provided/i.test(
    blob
  )
}
