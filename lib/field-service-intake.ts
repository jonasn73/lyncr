// Industry-specific intake field schemas — owner scheduler + receptionist notepad.

import { SCHEDULER_JOB_TYPES } from "@/lib/scheduler-utils"
import type { IntakeWorkspaceProfile } from "@/lib/workspace-intake-profile"

type FieldServiceFieldType =
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
const LOCKSMITH_INTAKE_FIELDS: FieldServiceFieldDef[] = [
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
const DETAILING_INTAKE_FIELDS: FieldServiceFieldDef[] = [
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
const GENERIC_INTAKE_FIELDS: FieldServiceFieldDef[] = [
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

const AUTO_REPAIR_INTAKE_FIELDS: FieldServiceFieldDef[] = [
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

/**
 * Job types within a profile that don't involve a vehicle at all — a house rekey has no
 * car to ask about, so asking for one (or "All Keys Lost", a car-key concept) is exactly
 * the kind of unnecessary question the owner console already skips via
 * `serviceTypeRequiresVehicle`. Every job type not listed here is assumed vehicle-based,
 * which is the safe default before a job type is even chosen.
 */
const NON_VEHICLE_JOB_TYPES: Partial<Record<IntakeWorkspaceProfile, readonly string[]>> = {
  locksmith: ["Rekey"],
  generic: ["Rekey"],
}

/** False once a job type that doesn't need a vehicle is chosen (e.g. "Rekey"). */
export function jobTypeRequiresVehicle(profile: IntakeWorkspaceProfile, jobType: string): boolean {
  const excluded = NON_VEHICLE_JOB_TYPES[profile]
  const trimmed = jobType.trim()
  if (!excluded || !trimmed) return true
  return !excluded.includes(trimmed)
}

/** Field groups that only make sense once a vehicle is actually involved. */
const VEHICLE_ONLY_GROUPS = new Set<FieldServiceFieldDef["group"]>(["vehicle", "locksmith", "detailing"])

/** Drop vehicle / vehicle-detail fields for a job type that doesn't need one. */
export function fieldsForJobType(
  fields: FieldServiceFieldDef[],
  profile: IntakeWorkspaceProfile,
  jobType: string
): FieldServiceFieldDef[] {
  if (jobTypeRequiresVehicle(profile, jobType)) return fields
  return fields.filter((f) => !VEHICLE_ONLY_GROUPS.has(f.group))
}

