// Owner-configurable per-tech capability flags (scripts/152-field-technician-capabilities.sql).
//
// Same shape and same rules as receptionist capabilities: one flat JSONB object of
// booleans, every flag off by default, and the server is the enforcement — hiding a
// button in the console is the courtesy, not the protection.
//
// Different vocabulary on purpose. A tech is not a receptionist with fewer buttons: the
// questions are "can they pick up their own work, reach the customer, take money, see
// their pay", which have no counterpart at the front desk. One word still means one thing
// — these keys simply do not overlap with hers.

import type { FieldTechnicianCapabilities } from "@/lib/types"

export type { FieldTechnicianCapabilities }

export const DEFAULT_FIELD_TECH_CAPABILITIES: FieldTechnicianCapabilities = {
  job_pool: false,
  customer_contact: false,
  collect_payment: false,
  view_earnings: false,
  key_lookup: false,
  inventory_control: false,
}

/** Short human label per capability — the one place a tech capability is named. */
export const FIELD_TECH_CAPABILITY_LABELS: Record<keyof FieldTechnicianCapabilities, string> = {
  job_pool: "Claim jobs",
  customer_contact: "Customer contact",
  collect_payment: "Collect payment",
  view_earnings: "See earnings",
  key_lookup: "Key lookup",
  inventory_control: "Inventory control",
}

/** Every tech capability the owner has turned on, in registry order. */
export function grantedFieldTechLabels(capabilities: FieldTechnicianCapabilities): string[] {
  return (Object.keys(FIELD_TECH_CAPABILITY_LABELS) as (keyof FieldTechnicianCapabilities)[])
    .filter((key) => capabilities[key] === true)
    .map((key) => FIELD_TECH_CAPABILITY_LABELS[key])
}

/** Tolerant of a missing column (undefined), a partial object, or unknown keys. */
export function parseFieldTechCapabilities(raw: unknown): FieldTechnicianCapabilities {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    job_pool: obj.job_pool === true,
    customer_contact: obj.customer_contact === true,
    collect_payment: obj.collect_payment === true,
    view_earnings: obj.view_earnings === true,
    key_lookup: obj.key_lookup === true,
    inventory_control: obj.inventory_control === true,
  }
}

/** True when this key names a tech capability — the seam that admits a tech at all. */
export function isFieldTechCapability(key: string): key is keyof FieldTechnicianCapabilities {
  return key in DEFAULT_FIELD_TECH_CAPABILITIES
}
