// Owner-configurable per-receptionist capability flags (scripts/150-receptionist-capabilities.sql).
//
// One flat object of booleans, following the admin_notification_preferences JSONB pattern —
// adding a capability later is "add a default + a parse line," no new migration or plumbing.

import type { ReceptionistCapabilities } from "@/lib/types"

export type { ReceptionistCapabilities }

export const DEFAULT_RECEPTIONIST_CAPABILITIES: ReceptionistCapabilities = {
  full_vehicle_key_catalog: false,
  dispatching: false,
}

/** Tolerant of a missing column (undefined), a partial object, or unknown keys. */
export function parseReceptionistCapabilities(raw: unknown): ReceptionistCapabilities {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    full_vehicle_key_catalog: obj.full_vehicle_key_catalog === true,
    dispatching: obj.dispatching === true,
  }
}
