// Owner-facing porting lifecycle — banner phases, pipeline steps, active-order filters.

import { orderHasFocScheduled } from "@/lib/porting-foc-detection"
import { orderRequiresPinCorrection } from "@/lib/porting-pin-correction"
import type { PortingOrder, PortingOrderStatus } from "@/lib/types"

export type PortingLifecycleHints = {
  /** Recent carrier / network message bodies (desk conversation). */
  carrierTexts?: string[]
}

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

/** Banner priority: rejected > action_needed (incl. PIN) > in_progress. */
export function getPortingBannerPhase(
  order: PortingOrder,
  unreadNotificationCount: number,
  hints?: PortingLifecycleHints
): PortingBannerPhase {
  if (order.status === "rejected") return "rejected"
  if (orderHasFocScheduled(order, hints?.carrierTexts)) return "in_progress"
  if (
    orderRequiresPinCorrection(order) ||
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
  unreadByTelnyxOrderId: Record<string, number>,
  carrierTextsByTelnyxOrderId?: Record<string, string[]>
): PortingOrder[] {
  const phaseRank: Record<PortingBannerPhase, number> = {
    rejected: 0,
    action_needed: 1,
    in_progress: 2,
  }
  return [...orders].sort((a, b) => {
    const aUnread = unreadByTelnyxOrderId[a.telnyx_order_id?.trim() ?? ""] ?? 0
    const bUnread = unreadByTelnyxOrderId[b.telnyx_order_id?.trim() ?? ""] ?? 0
    const telnyxA = a.telnyx_order_id?.trim() ?? ""
    const telnyxB = b.telnyx_order_id?.trim() ?? ""
    const aPhase = getPortingBannerPhase(a, aUnread, {
      carrierTexts: carrierTextsByTelnyxOrderId?.[telnyxA],
    })
    const bPhase = getPortingBannerPhase(b, bUnread, {
      carrierTexts: carrierTextsByTelnyxOrderId?.[telnyxB],
    })
    if (phaseRank[aPhase] !== phaseRank[bPhase]) return phaseRank[aPhase] - phaseRank[bPhase]
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

function activePipelineIndex(order: PortingOrder, hints?: PortingLifecycleHints): number {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  if (order.status === "completed" || ts === "ported") return 4
  if (orderHasFocScheduled(order, hints?.carrierTexts)) return 3
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
export function buildOwnerPortingPipeline(
  order: PortingOrder,
  hints?: PortingLifecycleHints
): OwnerPortingPipelineStep[] {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  const failed =
    order.status === "rejected" ||
    ts.includes("rejected") ||
    ts.includes("failed") ||
    ts.includes("cancelled") ||
    ts.includes("canceled")
  const active = activePipelineIndex(order, hints)

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
    return `⚠️ Carrier Response Needed: The transfer desk requested information for ${phone} to avoid rejection. Click to read carrier updates.`
  }
  return `🚚 Number Transfer in Progress: ${phone} is transferring onto Lyncr. Tracking status...`
}
