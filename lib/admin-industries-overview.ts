// ============================================
// Platform admin — industry coverage overview
// ============================================
// Pure aggregation over the existing per-industry registries (business-industries,
// ai-intake-field-registry, job-intake-registry, customer-equipment-registry,
// business-type) — no new storage. Answers "how does each industry actually work in
// our app today" for the /admin/industries page. Live account counts come from a
// single DB query (getAdminIndustryAccountCounts in lib/db.ts); everything else here
// is computed in-process from config that already drives the live product.

import { SIGNUP_INDUSTRY_OPTIONS, type AiIntakeProfileId } from "@/lib/business-industries"
import { INTAKE_REGISTRY } from "@/lib/ai-intake-field-registry"
import {
  resolveJobIntakeOptions,
  resolveJobIntakeOptionsSource,
  isVehicleAwareIndustry,
  type JobIntakeOptionSource,
} from "@/lib/job-intake-registry"
import { equipmentAwareProfile } from "@/lib/customer-equipment-registry"
import { resolveBusinessType } from "@/lib/business-type"
import type { ReceptionistBusinessType } from "@/lib/types"

/**
 * These five keep their own hand-written AI script in lib/ai-intake-defaults.ts instead of a
 * registry branch: locksmith/plumbing/hvac/electrical are bespoke by design (087); "generic" has
 * no registry entry at all and falls back to DEFAULT_BUSY_GENERIC there.
 */
const BESPOKE_AI_SCRIPT_PROFILES = new Set<AiIntakeProfileId>([
  "locksmith",
  "plumbing",
  "hvac",
  "electrical",
  "generic",
])

export type AdminIndustryOverviewRow = {
  id: AiIntakeProfileId
  label: string
  liveAccountCount: number
  aiScript: {
    source: "bespoke" | "registry"
    role: string | null
    branchTitles: string[]
  }
  jobTypes: {
    source: JobIntakeOptionSource
    options: { id: string; label: string }[]
  }
  vehicleAware: boolean
  equipment: { kind: string; label: string } | null
  /**
   * Receptionist live-call layout variant — resolveBusinessType keyword-matches whatever
   * string it's given, so this mirrors what a phone line's industry_tag would resolve to
   * if it were set to this exact industry slug. Known collision: "appliance_repair"
   * contains "repair" and resolves to the auto_repair layout, not a dedicated one — that's
   * an existing resolveBusinessType behavior, not something this page changes.
   */
  receptionistLayout: ReceptionistBusinessType
}

export function buildAdminIndustryOverview(
  accountCounts: Record<string, number>
): AdminIndustryOverviewRow[] {
  return SIGNUP_INDUSTRY_OPTIONS.map(({ value: id, label }) => {
    const registryEntry = INTAKE_REGISTRY[id]
    const aiScript = BESPOKE_AI_SCRIPT_PROFILES.has(id)
      ? { source: "bespoke" as const, role: null, branchTitles: [] }
      : {
          source: "registry" as const,
          role: registryEntry?.role ?? null,
          branchTitles: registryEntry?.branches.map((b) => b.title) ?? [],
        }
    const jobOptions = resolveJobIntakeOptions(id)
    return {
      id,
      label,
      liveAccountCount: accountCounts[id] ?? 0,
      aiScript,
      jobTypes: {
        source: resolveJobIntakeOptionsSource(id),
        options: jobOptions.map((o) => ({ id: o.id, label: o.label })),
      },
      vehicleAware: isVehicleAwareIndustry(id),
      equipment: equipmentAwareProfile(id),
      receptionistLayout: resolveBusinessType(id),
    }
  })
}
