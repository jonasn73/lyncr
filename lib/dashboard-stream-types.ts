import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { FallbackType, Organization, RoutingStrategy } from "@/lib/types"

/** Client-safe shape streamed from the server for the routing dashboard. */
export type DashboardRoutingBootstrap = {
  ownerPhone: string | null
  receptionists: Array<{
    id: string
    name: string
    phone: string
    initials: string
    color: string
  }>
  routing: {
    selected_receptionist_id: string | null
    fallback_type: FallbackType
    ai_ring_owner_first: boolean
    ring_timeout_seconds: number
    routing_strategy: RoutingStrategy
    allow_lyncr_network_fallback: boolean
    inbound_caller_greeting_enabled: boolean
    /** Show customer number on cell forwards (`103`). Default false = Lyncr business DID. */
    forward_original_caller_id: boolean
  }
  primaryLineNumber: string | null
}

/** One server payload for the main /dashboard shell — orgs, lines, and routing load together. */
export type DashboardMainBootstrap = {
  organizations: Organization[]
  phoneLines: DashboardBusinessNumber[]
  routing: DashboardRoutingBootstrap
}
