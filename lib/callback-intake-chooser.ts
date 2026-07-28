// Returning-caller / callback intake helpers — chooser step + service prefill from CRM.

import { serviceQuoteTypeFromJobType, serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import {
  SERVICE_QUOTE_TYPE_IDS,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"
import { serviceQuoteTypeIdFromIntake } from "@/lib/service-quote-calculator"

/** CRM open-lead fields used to continue a quote (upgrade-on-book). */
export type OpenQuotePrefillSource = {
  service_quote_type_id?: string | null
  job_type?: string | null
  summary?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  amount_cents?: number | null
}

/**
 * Resolve a real calculator id from CRM history — never invents Lockout from blanks.
 * Empty / missing stored type returns null so intake can clear the false Lockout default.
 */
export function serviceQuoteTypeIdFromCrmHistory(
  item: OpenQuotePrefillSource | null | undefined
): ServiceQuoteTypeId | null {
  if (!item) return null
  const rawId = String(item.service_quote_type_id ?? "").trim()
  if (rawId && (SERVICE_QUOTE_TYPE_IDS as readonly string[]).includes(rawId)) {
    return rawId as ServiceQuoteTypeId
  }
  // Legacy aliases stored before the current enum.
  if (rawId === "key_gen") return "key_generation"
  if (rawId === "key_dup") return "key_duplication"
  if (rawId === "ignition") return "ignition_repair"

  const jobType = String(item.job_type ?? "").trim()
  if (jobType) {
    const fromJob = serviceQuoteTypeFromJobType(jobType)
    // serviceQuoteTypeFromJobType falls through to "other" for unknown labels — keep that.
    if (fromJob !== "other" || /other/i.test(jobType)) return fromJob
    // Unknown job_type string that mapped to other — still useful if it was Key replacement etc.
    const intakeGuess = serviceQuoteTypeIdFromIntake(jobType, "")
    if (intakeGuess !== "other") return intakeGuess
    return fromJob
  }

  const summary = String(item.summary ?? "").trim().toLowerCase()
  if (summary) {
    // Summary lines are free text — match common key phrases before the exact intake labels.
    if (summary.includes("key replacement") || summary.includes("all keys lost") || summary.includes("akl")) {
      return "key_generation"
    }
    if (summary.includes("duplication") || summary.includes("spare key")) {
      return "key_duplication"
    }
    if (summary.includes("lockout")) return "lockout"
    const fromSummary = serviceQuoteTypeIdFromIntake(summary, "")
    if (fromSummary !== "other") return fromSummary
  }
  return null
}

/** Manual intake steps the Continue-quote path may land on. */
export type CallbackContinueStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"

/**
 * After Continue open quote: skip Service when type is known; otherwise land on Service.
 * Then Vehicle confirm when YMM missing; Address when location missing; else Schedule.
 */
export function continueOpenQuoteStep(params: {
  serviceTypeId: ServiceQuoteTypeId | ""
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  addressReady: boolean
}): CallbackContinueStep {
  const serviceId = (params.serviceTypeId || "") as ServiceQuoteTypeId | ""
  // Unknown type — show Service wizard (decision card already dismissed).
  if (!serviceId) return "SERVICE_SELECT"
  const ymmComplete = Boolean(
    params.vehicleYear.trim() && params.vehicleMake.trim() && params.vehicleModel.trim()
  )
  // Key / ignition / lockout-with-vehicle paths still need YMM confirm when empty.
  if (serviceTypeRequiresVehicle(serviceId) && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  // Lockout with garage YMM missing — still confirm vehicle before address.
  if (serviceId === "lockout" && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  if (!params.addressReady) return "ADDRESS_CONTACT"
  return "SCHEDULE_TIME"
}

/**
 * True when this phone should get the returning-caller decision card
 * (not a cold Service-first intake).
 */
export function isKnownReturningCaller(params: {
  hasMatchedCustomer: boolean
  hasPendingDraft: boolean
  openLeadId: string | null | undefined
  garageVehicleCount: number
  activeJobId: string | null | undefined
}): boolean {
  return Boolean(
    params.hasMatchedCustomer ||
      params.hasPendingDraft ||
      String(params.openLeadId ?? "").trim() ||
      params.garageVehicleCount > 0 ||
      String(params.activeJobId ?? "").trim()
  )
}

/** Open lead/quote exists — price optional (Allen-class thin leads still Continue). */
export function hasContinueableOpenLead(openLeadId: string | null | undefined): boolean {
  return Boolean(String(openLeadId ?? "").trim())
}

/**
 * Strip clarification spam ("Confirmed…") and truncate for the decision card.
 * Returns null when nothing useful remains.
 */
export function summarizeReturningCallerNotes(
  notes: string | null | undefined,
  maxLen = 72
): { preview: string; hasMore: boolean } | null {
  const raw = String(notes ?? "").trim()
  if (!raw) return null
  const parts = raw
    .split(/\s*[·•|]\s*|\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const kept = parts.filter((p) => {
    const lower = p.toLowerCase()
    if (lower.startsWith("confirmed ")) return false
    if (lower.startsWith("customer confirmed ")) return false
    return true
  })
  const cleaned = (kept.length > 0 ? kept : parts).join(" · ").replace(/\s+/g, " ").trim()
  if (!cleaned) return null
  if (cleaned.length <= maxLen) return { preview: cleaned, hasMore: false }
  return { preview: `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`, hasMore: true }
}

/** Compact YMM line for the decision card (garage / lead / form). */
export function formatReturningCallerVehicleFact(params: {
  year?: string | null
  make?: string | null
  model?: string | null
}): string | null {
  const label = [params.year, params.make, params.model]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
  return label || null
}

/** Garage / CRM vehicle chips used to fill missing lead YMM. */
export type GarageYmmSource = {
  year?: string | null
  make?: string | null
  model?: string | null
}

/**
 * Resolve YMM for Book / Continue — prefer lead collected, else garage head.
 * Keeps Quote→Book from restarting on a blank Service/Lockout vehicle step.
 */
export function resolveOpenQuoteYmm(params: {
  lead?: OpenQuotePrefillSource | null
  garage?: GarageYmmSource | null
}): { year: string; make: string; model: string } {
  const leadYear = String(params.lead?.vehicle_year ?? "").trim()
  const leadMake = String(params.lead?.vehicle_make ?? "").trim()
  const leadModel = String(params.lead?.vehicle_model ?? "").trim()
  if (leadYear || leadMake || leadModel) {
    return { year: leadYear, make: leadMake, model: leadModel }
  }
  return {
    year: String(params.garage?.year ?? "").trim(),
    make: String(params.garage?.make ?? "").trim(),
    model: String(params.garage?.model ?? "").trim(),
  }
}

/**
 * Pool-ready open quote: enough to schedule/assign in JobDetailDrawer.
 * Thin quote (missing vehicle or address) should Continue-intake instead.
 */
export function isOpenLeadPoolReady(params: {
  lead: OpenQuotePrefillSource & { has_job_address?: boolean | null }
  /** Customer profile street/city when lead collected has no job address. */
  customerAddressReady?: boolean
  garage?: GarageYmmSource | null
}): boolean {
  const serviceTypeId = serviceQuoteTypeIdFromCrmHistory(params.lead) ?? ""
  const ymm = resolveOpenQuoteYmm({ lead: params.lead, garage: params.garage })
  const addressReady = Boolean(params.lead.has_job_address) || Boolean(params.customerAddressReady)
  return (
    continueOpenQuoteStep({
      serviceTypeId,
      vehicleYear: ymm.year,
      vehicleMake: ymm.make,
      vehicleModel: ymm.model,
      addressReady,
    }) === "SCHEDULE_TIME"
  )
}
