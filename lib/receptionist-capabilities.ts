// Owner-configurable per-receptionist capability flags (scripts/150-receptionist-capabilities.sql).
//
// One flat object of booleans, following the admin_notification_preferences JSONB pattern —
// adding a capability later is "add a default + a parse line," no new migration or plumbing.
//
// Every flag defaults to FALSE: a receptionist starts with intake only (she answers the
// phone) and the owner opens up the rest of the console one surface at a time. Nothing
// here is a UI hint — lib/workspace-actor.ts enforces the same object server-side.

import type { ReceptionistCapabilities } from "@/lib/types"

export type { ReceptionistCapabilities }

export const DEFAULT_RECEPTIONIST_CAPABILITIES: ReceptionistCapabilities = {
  full_vehicle_key_catalog: false,
  dispatching: false,
  crm_access: false,
  crm_edit: false,
  scheduler: false,
  invoicing: false,
  invoicing_send: false,
  call_intake: false,
}

/**
 * Short human label per capability — the ONE place they are named.
 *
 * The owner sees these twice: in the access editor's toggle list and in the summary line
 * on the team roster. They drifted once already (the summary knew about two flags and
 * silently read "Default" for the rest), so both now read this map.
 */
export const RECEPTIONIST_CAPABILITY_LABELS: Record<keyof ReceptionistCapabilities, string> = {
  full_vehicle_key_catalog: "Full key lookup",
  dispatching: "Dispatching",
  crm_access: "Customer book",
  crm_edit: "Edit customers",
  scheduler: "Scheduler",
  invoicing: "See invoicing",
  invoicing_send: "Send invoices",
  call_intake: "Call intake",
}

/** Every capability the owner has turned on, in registry order. */
export function grantedCapabilityLabels(capabilities: ReceptionistCapabilities): string[] {
  return (Object.keys(RECEPTIONIST_CAPABILITY_LABELS) as (keyof ReceptionistCapabilities)[])
    .filter((key) => capabilities[key] === true)
    .map((key) => RECEPTIONIST_CAPABILITY_LABELS[key])
}

/** An owner has every capability. Derived, so a new flag is granted without editing this. */
export const ALL_CAPABILITIES_GRANTED: ReceptionistCapabilities = (
  Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES) as (keyof ReceptionistCapabilities)[]
).reduce((granted, key) => {
  granted[key] = true
  return granted
}, {} as ReceptionistCapabilities)

/** Tolerant of a missing column (undefined), a partial object, or unknown keys. */
export function parseReceptionistCapabilities(raw: unknown): ReceptionistCapabilities {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    full_vehicle_key_catalog: obj.full_vehicle_key_catalog === true,
    dispatching: obj.dispatching === true,
    crm_access: obj.crm_access === true,
    crm_edit: obj.crm_edit === true,
    scheduler: obj.scheduler === true,
    invoicing: obj.invoicing === true,
    invoicing_send: obj.invoicing_send === true,
    call_intake: obj.call_intake === true,
  }
}
