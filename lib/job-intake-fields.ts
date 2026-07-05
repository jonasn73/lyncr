// Map scheduler job_type labels ↔ service quote calculator ids (shared by intake + job drawer).

import { formatIntakeJobTypeForDispatch } from "@/lib/intake-job-types"
import {
  SERVICE_QUOTE_TYPES,
  serviceQuoteTypeIdFromIntake,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"

/** Pull origination vs duplication from a stored dispatch job type label. */
export function parseKeyModeFromJobType(jobType: string): string {
  if (jobType.includes("Duplication")) return "Duplication"
  if (jobType.includes("Origination")) return "Origination"
  return ""
}

/** Base intake job type before the " — Origination" suffix. */
export function parseIntakeJobTypeBase(jobType: string): string {
  if (jobType.startsWith("Key replacement")) return "Key replacement"
  const first = jobType.split("—")[0]?.trim() || jobType.trim()
  return first || "Other"
}

/** Resolve calculator service id from a stored job_type string. */
export function serviceQuoteTypeFromJobType(jobType: string): ServiceQuoteTypeId {
  return serviceQuoteTypeIdFromIntake(parseIntakeJobTypeBase(jobType), parseKeyModeFromJobType(jobType))
}

/** Value stored on ai_leads.job_type / collected.job_type from a calculator selection. */
export function dispatchJobTypeFromServiceQuoteTypeId(id: ServiceQuoteTypeId): string {
  const spec = SERVICE_QUOTE_TYPES.find((s) => s.id === id) ?? SERVICE_QUOTE_TYPES[0]
  return formatIntakeJobTypeForDispatch(spec.jobType, spec.keyMode)
}

/** True when YMM + key variant UI should show (matches CallAnsweredModal). */
export function serviceTypeRequiresVehicle(serviceTypeId: ServiceQuoteTypeId): boolean {
  return serviceTypeId === "key_gen" || serviceTypeId === "key_dup" || serviceTypeId === "ignition"
}
