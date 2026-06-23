import type { FallbackType, RoutingStrategy } from "@/lib/types"

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
  }
  primaryLineNumber: string | null
}
