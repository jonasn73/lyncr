// Industry-specific intake field schemas — owner scheduler + receptionist notepad.

import { SCHEDULER_JOB_TYPES } from "@/lib/scheduler-utils"
import type { IntakeWorkspaceProfile } from "@/lib/workspace-intake-profile"

export type FieldServiceFieldType =
  | "text"
  | "textarea"
  | "select"
  | "toggle"
  | "checkbox"
  | "address"
  | "vehicle_cascade"
  | "vin_lookup"

export type FieldServiceFieldDef = {
  name: string
  label: string
  type: FieldServiceFieldType
  placeholder?: string
  options?: readonly string[]
  required?: boolean
  full?: boolean
  group?: "vehicle" | "locksmith" | "detailing" | "job" | "scheduling"
}

const SHARED_JOB_FIELDS: FieldServiceFieldDef[] = [
  {
    name: "job_address",
    label: "Job address",
    type: "address",
    placeholder: "123 Main St, Louisville KY 40202",
    required: true,
    full: true,
    group: "job",
  },
  {
    name: "job_notes",
    label: "Job notes",
    type: "textarea",
    placeholder: "Access instructions, damage notes…",
    full: true,
    group: "job",
  },
  {
    name: "preferred_time",
    label: "Preferred time",
    type: "text",
    placeholder: "Sat 10 AM",
    group: "scheduling",
  },
]

/** Automotive locksmith — Key Squad style (vehicle cascade + AKL / key type). */
export const LOCKSMITH_INTAKE_FIELDS: FieldServiceFieldDef[] = [
  {
    name: "vin",
    label: "VIN lookup",
    type: "vin_lookup",
    placeholder: "17-character VIN",
    full: true,
    group: "vehicle",
  },
  {
    name: "vehicle_cascade",
    label: "Vehicle",
    type: "vehicle_cascade",
    required: true,
    full: true,
    group: "vehicle",
  },
  {
    name: "job_type",
    label: "Job type",
    type: "select",
    options: ["Lockout", "Rekey", "Key replacement", "Ignition", "Emergency dispatch", "Other"],
    required: true,
    group: "job",
  },
  {
    name: "all_keys_lost",
    label: "All Keys Lost (AKL)",
    type: "checkbox",
    group: "locksmith",
  },
  {
    name: "key_type_smart_prox",
    label: "Key Type: Smart / Prox",
    type: "checkbox",
    group: "locksmith",
  },
  {
    name: "laser_cut_required",
    label: "Laser Cut Required",
    type: "checkbox",
    group: "locksmith",
  },
  ...SHARED_JOB_FIELDS,
]

/** Mobile detailing — Fresh Auto Detail style. */
export const DETAILING_INTAKE_FIELDS: FieldServiceFieldDef[] = [
  {
    name: "vin",
    label: "VIN lookup (optional)",
    type: "vin_lookup",
    placeholder: "17-character VIN",
    full: true,
    group: "vehicle",
  },
  {
    name: "vehicle_cascade",
    label: "Vehicle",
    type: "vehicle_cascade",
    required: true,
    full: true,
    group: "vehicle",
  },
  {
    name: "vehicle_size_category",
    label: "Vehicle size category",
    type: "select",
    options: ["Sedan", "SUV", "Truck", "Van", "Exotic / Oversized"],
    required: true,
    group: "detailing",
  },
  {
    name: "job_type",
    label: "Service package",
    type: "select",
    options: ["Interior only", "Exterior only", "Full detail", "Ceramic coating", "Paint correction"],
    required: true,
    group: "job",
  },
  {
    name: "pet_hair_extraction",
    label: "Pet Hair Extraction Required",
    type: "checkbox",
    group: "detailing",
  },
  {
    name: "onsite_water_power",
    label: "On-site Water / Power available",
    type: "checkbox",
    group: "detailing",
  },
  ...SHARED_JOB_FIELDS,
]

/** Generic automotive field service fallback. */
export const GENERIC_INTAKE_FIELDS: FieldServiceFieldDef[] = [
  {
    name: "vehicle_cascade",
    label: "Vehicle",
    type: "vehicle_cascade",
    required: true,
    full: true,
    group: "vehicle",
  },
  {
    name: "job_type",
    label: "Job type",
    type: "select",
    options: SCHEDULER_JOB_TYPES,
    required: true,
    group: "job",
  },
  ...SHARED_JOB_FIELDS,
]

export const AUTO_REPAIR_INTAKE_FIELDS: FieldServiceFieldDef[] = [
  {
    name: "vehicle_cascade",
    label: "Vehicle",
    type: "vehicle_cascade",
    required: true,
    full: true,
    group: "vehicle",
  },
  {
    name: "job_type",
    label: "Service needed",
    type: "select",
    options: [
      "Diagnostic / check engine",
      "Brakes",
      "Oil change",
      "Tires / alignment",
      "Engine / transmission",
      "Other",
    ],
    required: true,
    group: "job",
  },
  ...SHARED_JOB_FIELDS,
]

export const FIELD_SERVICE_INTAKE_TITLES: Record<IntakeWorkspaceProfile, string> = {
  locksmith: "Locksmith dispatch intake",
  detailing: "Detailing dispatch intake",
  auto_repair: "Auto repair dispatch intake",
  generic: "Field dispatch intake",
}

export function intakeFieldsForProfile(profile: IntakeWorkspaceProfile): FieldServiceFieldDef[] {
  switch (profile) {
    case "locksmith":
      return LOCKSMITH_INTAKE_FIELDS
    case "detailing":
      return DETAILING_INTAKE_FIELDS
    case "auto_repair":
      return AUTO_REPAIR_INTAKE_FIELDS
    default:
      return GENERIC_INTAKE_FIELDS
  }
}

export function intakeTitleForProfile(profile: IntakeWorkspaceProfile): string {
  return FIELD_SERVICE_INTAKE_TITLES[profile] ?? FIELD_SERVICE_INTAKE_TITLES.generic
}

/** Build "2021 Ford F-150" from collected intake fields (supports legacy key names). */
export function formatVehicleLabel(fields: Record<string, unknown>): string | null {
  const year = String(fields.vehicle_year ?? fields.year ?? "").trim()
  const make = String(fields.vehicle_make ?? fields.make ?? "").trim()
  const model = String(fields.vehicle_model ?? fields.model ?? "").trim()
  const combined = String(fields.vehicle ?? "").trim()
  if (year || make || model) return [year, make, model].filter(Boolean).join(" ")
  return combined || null
}

/** One-line summary for SMS / lead rows from automotive intake fields. */
export function buildFieldServiceSummary(
  fields: Record<string, unknown>,
  extras?: { customerName?: string | null; disposition?: string | null }
): string {
  const parts: string[] = []
  const vehicle = formatVehicleLabel(fields)
  const jobType = String(fields.job_type ?? fields.service_type ?? fields.service_package ?? "").trim()
  const address = String(
    fields.job_address ?? fields.job_address_full ?? fields.service_address ?? fields.location ?? fields.address ?? ""
  ).trim()
  const notes = String(fields.job_notes ?? fields.notes ?? "").trim()
  if (jobType) parts.push(jobType)
  if (vehicle) parts.push(vehicle)
  if (extras?.customerName?.trim()) parts.push(extras.customerName.trim())
  if (address) parts.push(address)
  if (fields.all_keys_lost === true || fields.all_keys_lost === "true") parts.push("AKL")
  if (fields.key_type_smart_prox === true || fields.key_type_smart_prox === "true") parts.push("Smart/Prox key")
  if (fields.laser_cut_required === true || fields.laser_cut_required === "true") parts.push("Laser cut")
  if (fields.vehicle_size_category) parts.push(String(fields.vehicle_size_category))
  if (fields.pet_hair_extraction === true || fields.pet_hair_extraction === "true") parts.push("Pet hair")
  if (notes) parts.push(notes)
  if (extras?.disposition) parts.push(extras.disposition)
  return parts.join(" · ") || "Field service dispatch"
}

/** @deprecated Use intakeFieldsForProfile — kept for imports that expect a flat list. */
export const AUTOMOTIVE_FIELD_SERVICE_FIELDS = GENERIC_INTAKE_FIELDS
