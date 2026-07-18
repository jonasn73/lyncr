// Sector grouping + manual intake step routing for the service card grid.

import { serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"

export type ServiceSector = "automotive" | "residential" | "commercial"

export const SERVICE_SECTOR_ORDER: ServiceSector[] = ["automotive", "residential", "commercial"]

export const SERVICE_SECTOR_LABELS: Record<ServiceSector, string> = {
  automotive: "Automotive",
  residential: "Residential",
  commercial: "Commercial",
}

export const SERVICE_IDS_BY_SECTOR: Record<ServiceSector, readonly ServiceQuoteTypeId[]> = {
  automotive: [
    "lockout",
    "key_generation",
    "key_duplication",
    "programming_diagnostics",
    "ignition_repair",
    "key_extraction",
  ],
  residential: ["rekey", "lock_installation", "safe_lockout", "keypad_smart_lock"],
  commercial: ["commercial_hardware", "master_key_system", "door_closer_repair"],
}

/**
 * Automotive job types chosen AFTER year/make/model (AKL vs Spare, etc.).
 * Hidden from the first Service screen when intake defers them.
 */
export const AUTOMOTIVE_JOB_TYPE_IDS: readonly ServiceQuoteTypeId[] = [
  "key_generation",
  "key_duplication",
  "programming_diagnostics",
  "ignition_repair",
  "key_extraction",
]

/**
 * True when intake should ask AKL/Spare (etc.) after Vehicle, before Key details.
 * Only automotive key jobs require vehicle — lockout / home / re-key never hit this step.
 */
export function serviceNeedsJobTypeStep(serviceTypeId: ServiceQuoteTypeId): boolean {
  return serviceTypeRequiresVehicle(serviceTypeId)
}

/** Resolve which sector pill should be active for a saved or selected service type. */
export function serviceSectorForType(serviceTypeId: ServiceQuoteTypeId): ServiceSector {
  if (SERVICE_IDS_BY_SECTOR.commercial.includes(serviceTypeId)) return "commercial"
  if (SERVICE_IDS_BY_SECTOR.residential.includes(serviceTypeId)) return "residential"
  return "automotive"
}

/** Next manual intake canvas after a service card is tapped. */
export function manualIntakeStepAfterService(
  serviceTypeId: ServiceQuoteTypeId
): "VEHICLE_INFO" | "ADDRESS_CONTACT" {
  return serviceTypeRequiresVehicle(serviceTypeId) ? "VEHICLE_INFO" : "ADDRESS_CONTACT"
}

/** Primary AKL / Spare choices on the JOB_TYPE step (others under “More”). */
export const PRIMARY_JOB_TYPE_IDS: readonly ServiceQuoteTypeId[] = [
  "key_generation",
  "key_duplication",
]

/** Remaining automotive job types collapsed under “More…” on JOB_TYPE. */
export const SECONDARY_JOB_TYPE_IDS: readonly ServiceQuoteTypeId[] = AUTOMOTIVE_JOB_TYPE_IDS.filter(
  (id) => !(PRIMARY_JOB_TYPE_IDS as readonly string[]).includes(id)
) as ServiceQuoteTypeId[]
