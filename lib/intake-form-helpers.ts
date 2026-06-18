// Intake form helpers — safe to import from scheduler without pulling heavy UI components.

import { intakeFieldsForProfile, intakeTitleForProfile, type FieldServiceFieldDef } from "@/lib/field-service-intake"
import {
  resolveWorkspaceIntakeProfile,
  type IntakeWorkspaceProfile,
} from "@/lib/workspace-intake-profile"
import type { StructuredAddress } from "@/lib/structured-address"

export type IntakeFormValues = Record<string, string | boolean | StructuredAddress | null>

/** Flatten intake values for API payloads (expands structured address into columns). */
export function serializeIntakeValues(values: IntakeFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v == null) continue
    if (typeof v === "object" && "formatted" in v && "street_number" in v) {
      const addr = v as StructuredAddress
      out.job_address = addr.formatted
      out.job_address_full = addr.formatted
      out.location = addr.formatted
      out.service_address = addr.formatted
      out.job_address_street_number = addr.street_number
      out.job_address_route = addr.route
      out.job_address_locality = addr.locality
      out.job_address_postal_code = addr.postal_code
      out.job_address_admin_area = addr.admin_area
      if (addr.lat != null) out.customer_lat = addr.lat
      if (addr.lng != null) out.customer_lng = addr.lng
      continue
    }
    out[k] = v
  }
  return out
}

/** True when required industry fields are filled (vehicle + validated address). */
export function intakeValuesComplete(fields: FieldServiceFieldDef[], values: IntakeFormValues): boolean {
  for (const f of fields) {
    if (!f.required) continue
    if (f.type === "vehicle_cascade") {
      if (!String(values.vehicle_year ?? "").trim()) return false
      if (!String(values.vehicle_make ?? "").trim()) return false
      if (!String(values.vehicle_model ?? "").trim()) return false
      continue
    }
    if (f.type === "address") {
      const addr = values[f.name] as StructuredAddress | null
      if (!addr?.formatted?.trim()) return false
      continue
    }
    const v = values[f.name]
    if (v === undefined || v === "" || v === false) return false
  }
  return true
}

/** Resolve intake title from workspace context (for modal headers). */
export function intakeTitleFromWorkspaceContext(params: {
  intakeProfile?: IntakeWorkspaceProfile
  organizationName?: string | null
  industryTags?: Array<string | null | undefined>
}): string {
  const profile =
    params.intakeProfile ??
    resolveWorkspaceIntakeProfile({
      organizationName: params.organizationName,
      industryTags: params.industryTags,
    })
  return intakeTitleForProfile(profile)
}

/** Resolve field defs from workspace context. */
export function intakeFieldsFromWorkspaceContext(params: {
  intakeProfile?: IntakeWorkspaceProfile
  organizationName?: string | null
  industryTags?: Array<string | null | undefined>
}): FieldServiceFieldDef[] {
  const profile =
    params.intakeProfile ??
    resolveWorkspaceIntakeProfile({
      organizationName: params.organizationName,
      industryTags: params.industryTags,
    })
  return intakeFieldsForProfile(profile)
}
