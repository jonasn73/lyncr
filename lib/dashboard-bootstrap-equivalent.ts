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

  for (let i = 0; i < a.organizations.length; i++) {
    const ao = a.organizations[i]
    const bo = b.organizations[i]
    if (!bo || ao.id !== bo.id || ao.name !== bo.name || ao.is_default !== bo.is_default) {
      return false
    }
  }

  for (let i = 0; i < a.phoneLines.length; i++) {
    const al = a.phoneLines[i]
    const bl = b.phoneLines[i]
    if (
      !bl ||
      al.number !== bl.number ||
      al.status !== bl.status ||
      al.organization_id !== bl.organization_id ||
      (al.label ?? "") !== (bl.label ?? "")
    ) {
      return false
    }
  }

  for (let i = 0; i < a.routing.receptionists.length; i++) {
    const ar = a.routing.receptionists[i]
    const br = b.routing.receptionists[i]
    if (!br || ar.id !== br.id || ar.name !== br.name || ar.phone !== br.phone) {
      return false
    }
  }

  const ar = a.routing.routing
  const br = b.routing.routing
  return (
    ar.selected_receptionist_id === br.selected_receptionist_id &&
    ar.fallback_type === br.fallback_type &&
    ar.ai_ring_owner_first === br.ai_ring_owner_first &&
    ar.ring_timeout_seconds === br.ring_timeout_seconds &&
    ar.routing_strategy === br.routing_strategy &&
    ar.allow_lyncr_network_fallback === br.allow_lyncr_network_fallback &&
    ar.inbound_caller_greeting_enabled === br.inbound_caller_greeting_enabled &&
    ar.forward_original_caller_id === br.forward_original_caller_id
  )
}
