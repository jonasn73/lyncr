import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"

/** Avoid re-rendering the whole dashboard when the refresh promise returns the same payload. */
export function dashboardBootstrapEquivalent(
  a: DashboardMainBootstrap,
  b: DashboardMainBootstrap
): boolean {
  if (a === b) return true
  if (a.organizations.length !== b.organizations.length) return false
  if (a.phoneLines.length !== b.phoneLines.length) return false
  if (a.routing.primaryLineNumber !== b.routing.primaryLineNumber) return false
  if (a.routing.ownerPhone !== b.routing.ownerPhone) return false
  if (a.routing.receptionists.length !== b.routing.receptionists.length) return false

  const ar = a.routing.routing
  const br = b.routing.routing
  return (
    ar.selected_receptionist_id === br.selected_receptionist_id &&
    ar.fallback_type === br.fallback_type &&
    ar.ai_ring_owner_first === br.ai_ring_owner_first &&
    ar.ring_timeout_seconds === br.ring_timeout_seconds &&
    ar.routing_strategy === br.routing_strategy &&
    ar.allow_lyncr_network_fallback === br.allow_lyncr_network_fallback
  )
}
