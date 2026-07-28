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
  | "VEHICLE_INFO"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"

/**
 * After Continue open quote: skip Service and land on the next useful confirm step.
 * Vehicle confirm when YMM missing; Address when location missing; else Schedule.
 */
export function continueOpenQuoteStep(params: {
  serviceTypeId: ServiceQuoteTypeId | ""
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  addressReady: boolean
}): CallbackContinueStep {
  const serviceId = (params.serviceTypeId || "") as ServiceQuoteTypeId | ""
  const ymmComplete = Boolean(
    params.vehicleYear.trim() && params.vehicleMake.trim() && params.vehicleModel.trim()
  )
  // Key / ignition / lockout-with-vehicle paths still need YMM confirm when empty.
  if (serviceId && serviceTypeRequiresVehicle(serviceId) && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  // Lockout with garage YMM missing — still confirm vehicle before address.
  if ((!serviceId || serviceId === "lockout") && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  if (!params.addressReady) return "ADDRESS_CONTACT"
  return "SCHEDULE_TIME"
}
