// ============================================
// Industry-aware manual intake job types (087)
// ============================================
// Powers the JOB_TYPE step in components/dashboard/CallAnsweredModal.tsx.
// Mirrors lib/ai-intake-field-registry.ts's per-industry taxonomy — reuses the same
// categories the AI phone script already asks about, so a plumber's manual intake matches
// a plumber's AI intake, instead of every trade seeing locksmith's Lockout/AKL/Programming list.
//
// Locksmith keeps its existing SERVICE_QUOTE_TYPES + rate-card quote calculator untouched —
// that's the app's original, most-refined flow, zero behavior change. Every other trade gets
// a first-pass generic list: trade-correct labels with manual price entry (CallAnsweredModal
// already falls back to its `customPrice` field whenever the automatic rate-card quote comes
// back empty, so this is a supported path, not a new one).

import type { AiIntakeProfileId } from "./business-industries"
import { SERVICE_QUOTE_TYPES } from "./service-quote-calculator"
import { INTAKE_REGISTRY } from "./ai-intake-field-registry"

export type JobIntakeOption = {
  id: string
  label: string
  requiresVehicle: boolean
}

/** Locksmith's real job types — unchanged, still drive the existing rate-card quote calculator. */
const LOCKSMITH_VEHICLE_IDS = new Set([
  "lockout",
  "safe_lockout",
  "key_generation",
  "key_duplication",
  "ignition_repair",
  "programming_diagnostics",
  "key_extraction",
])

const LOCKSMITH_OPTIONS: JobIntakeOption[] = SERVICE_QUOTE_TYPES.map((s) => ({
  id: s.id,
  label: s.label,
  requiresVehicle: LOCKSMITH_VEHICLE_IDS.has(s.id),
}))

/**
 * Plumbing / HVAC / electrical don't have lib/ai-intake-field-registry.ts branch entries —
 * they're bespoke single-greeting profiles in lib/ai-intake-defaults.ts instead. These
 * categories mirror that greeting's own spoken options (DEFAULT_BUSY_GREETING_PLUMBING etc.)
 * so the manual form and the AI phone script agree on the same taxonomy.
 */
const BESPOKE_OPTIONS: Partial<Record<AiIntakeProfileId, JobIntakeOption[]>> = {
  plumbing: [
    { id: "plumbing_emergency_leak", label: "Active Leak / Emergency", requiresVehicle: false },
    { id: "plumbing_drain_clog", label: "Drain or Clog", requiresVehicle: false },
    { id: "plumbing_water_heater", label: "Water Heater", requiresVehicle: false },
    { id: "plumbing_other", label: "Other Plumbing", requiresVehicle: false },
  ],
  hvac: [
    { id: "hvac_no_heat", label: "No Heat", requiresVehicle: false },
    { id: "hvac_no_cooling", label: "No Cooling", requiresVehicle: false },
    { id: "hvac_maintenance", label: "Tune-up / Maintenance", requiresVehicle: false },
    { id: "hvac_other", label: "Other HVAC", requiresVehicle: false },
  ],
  electrical: [
    { id: "electrical_safety", label: "Sparks / Smoke / Safety Concern", requiresVehicle: false },
    { id: "electrical_partial_power", label: "Partial Power", requiresVehicle: false },
    { id: "electrical_install_repair", label: "Install or Repair", requiresVehicle: false },
    { id: "electrical_other", label: "Other Electrical", requiresVehicle: false },
  ],
}

/** Trades whose registry branches genuinely involve a vehicle. */
const VEHICLE_AWARE_PROFILES = new Set<AiIntakeProfileId>(["auto_repair", "towing"])

const GENERIC_OPTIONS: JobIntakeOption[] = [
  { id: "generic_service_call", label: "Service Call", requiresVehicle: false },
  { id: "generic_estimate", label: "Estimate / Quote", requiresVehicle: false },
  { id: "generic_other", label: "Other", requiresVehicle: false },
]

/** Build job-type options from an ai-intake-field-registry entry's branches. */
function optionsFromRegistry(profileId: AiIntakeProfileId): JobIntakeOption[] | null {
  const entry = INTAKE_REGISTRY[profileId]
  if (!entry) return null
  const requiresVehicle = VEHICLE_AWARE_PROFILES.has(profileId)
  return entry.branches.map((branch, i) => ({
    id: `${profileId}_${branch.intent_slug || i}`,
    label: branch.title,
    requiresVehicle,
  }))
}

/**
 * Resolve the manual-intake job-type options for an account. `industry` is `users.industry` —
 * null/undefined/unrecognized (accounts that predate this field, or never touched it — this
 * app was locksmith-only for most of its history) safely falls back to the locksmith list,
 * matching every pre-existing account's current behavior exactly.
 */
export function resolveJobIntakeOptions(industry: string | null | undefined): JobIntakeOption[] {
  const id = (industry || "").trim().toLowerCase()
  if (!id || id === "locksmith") return LOCKSMITH_OPTIONS
  const bespoke = BESPOKE_OPTIONS[id as AiIntakeProfileId]
  if (bespoke) return bespoke
  const fromRegistry = optionsFromRegistry(id as AiIntakeProfileId)
  if (fromRegistry && fromRegistry.length > 0) return fromRegistry
  return GENERIC_OPTIONS
}

export function jobIntakeOptionRequiresVehicle(
  industry: string | null | undefined,
  optionId: string
): boolean {
  const options = resolveJobIntakeOptions(industry)
  return options.find((o) => o.id === optionId)?.requiresVehicle ?? false
}
