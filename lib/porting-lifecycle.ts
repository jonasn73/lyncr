// Owner-facing porting lifecycle — banner phases, pipeline steps, active-order filters.

import type { PortingOrder, PortingOrderStatus } from "@/lib/types"

export type PortingBannerPhase = "in_progress" | "action_needed" | "rejected"

export type OwnerPortingPipelineStep = {
  key: string
  label: string
  state: "complete" | "current" | "upcoming" | "failed"
}

export const OWNER_PORTING_PIPELINE = [
  { key: "submitted", label: "Submitted" },
  { key: "carrier_intake", label: "Carrier Intake" },
  { key: "action_verifying", label: "Action Required / Verifying" },
  { key: "foc_scheduled", label: "FOC Date Scheduled" },
  { key: "live", label: "Live" },
] as const

const TERMINAL_STATUSES: PortingOrderStatus[] = ["completed"]

/** True while the transfer is still in flight (show lifecycle banner). */
export function isActivePortingOrder(order: PortingOrder): boolean {
  return !TERMINAL_STATUSES.includes(order.status)
}

/** Banner priority: rejected > action_needed > in_progress. */
export function getPortingBannerPhase(order: PortingOrder, unreadNotificationCount: number): PortingBannerPhase {
  if (order.status === "rejected") return "rejected"
  if (
    order.status === "action_required" ||
    order.status === "pending_info" ||
    unreadNotificationCount > 0
  ) {
    return "action_needed"
  }
  return "in_progress"
}

/** Sort active orders so the most urgent banner surfaces first. */
export function sortPortingOrdersForBanner(
  orders: PortingOrder[],
  unreadByTelnyxOrderId: Record<string, number>
): PortingOrder[] {
  const phaseRank: Record<PortingBannerPhase, number> = {
    rejected: 0,
    action_needed: 1,
    in_progress: 2,
  }
  return [...orders].sort((a, b) => {
    const aUnread = unreadByTelnyxOrderId[a.telnyx_order_id?.trim() ?? ""] ?? 0
    const bUnread = unreadByTelnyxOrderId[b.telnyx_order_id?.trim() ?? ""] ?? 0
    const aPhase = getPortingBannerPhase(a, aUnread)
    const bPhase = getPortingBannerPhase(b, bUnread)
    if (phaseRank[aPhase] !== phaseRank[bPhase]) return phaseRank[aPhase] - phaseRank[bPhase]
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

function activePipelineIndex(order: PortingOrder): number {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  if (order.status === "completed" || ts === "ported") return 4
  if (
    ["foc-date-confirmed", "foc-date-confirmed-pending", "port-activating", "activation-in-progress"].includes(ts)
  ) {
    return 3
  }
  if (
    order.status === "action_required" ||
    order.status === "pending_info" ||
    ts.includes("exception") ||
    ts.includes("action")
  ) {
    return 2
  }
  if (
    order.status === "processing" ||
    order.status === "pending_carrier_review" ||
    ["in-process", "submitted"].includes(ts)
  ) {
    return 1
  }
  return 0
}

/** Five-step pipeline for the owner interaction drawer. */
export function buildOwnerPortingPipeline(order: PortingOrder): OwnerPortingPipelineStep[] {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  const failed =
    order.status === "rejected" ||
    ts.includes("rejected") ||
    ts.includes("failed") ||
    ts.includes("cancelled") ||
    ts.includes("canceled")
  const active = activePipelineIndex(order)

  return OWNER_PORTING_PIPELINE.map((step, idx) => {
    let state: OwnerPortingPipelineStep["state"] = "upcoming"
    if (failed && idx === Math.min(active, 2)) state = "failed"
    else if (idx < active) state = "complete"
    else if (idx === active) state = "current"
    return { ...step, state }
  })
}

export function portingBannerMessage(order: PortingOrder, phase: PortingBannerPhase): string {
  const phone = order.phone_number
  if (phase === "rejected") {
    return `❌ Transfer Overdue/Rejected: Click to fix credentials and resubmit.`
  }
  if (phase === "action_needed") {
    return `⚠️ Telnyx Response Needed: Telnyx has requested information for ${phone} to avoid carrier rejection. Click to view message.`
  }
  return `🚚 Number Transfer in Progress: ${phone} is transferring onto Lyncr. Tracking status...`
}
