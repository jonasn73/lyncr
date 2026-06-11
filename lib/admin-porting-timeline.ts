// Admin porting pipeline — maps Telnyx / DB status to a vertical stepper.

import type { PortingOrder } from "@/lib/types"

export type AdminPortingPipelineStepState = "complete" | "current" | "upcoming" | "failed"

export type AdminPortingPipelineStep = {
  key: string
  label: string
  state: AdminPortingPipelineStepState
}

const PIPELINE_DEF = [
  { key: "submitted", label: "Submitted" },
  { key: "pending_documents", label: "Pending documents" },
  { key: "carrier_review", label: "Carrier review" },
  { key: "foc_assigned", label: "FOC assigned" },
  { key: "live", label: "Live on Lyncr" },
] as const

/** Resolve which pipeline index is active for an order. */
function activePipelineIndex(order: PortingOrder): number {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  if (order.status === "completed" || ts === "ported") return 4
  if (
    ["foc-date-confirmed", "foc-date-confirmed-pending", "port-activating", "activation-in-progress"].includes(ts)
  ) {
    return 3
  }
  if (order.status === "processing" || ["in-process", "submitted"].includes(ts)) return 2
  if (ts.includes("exception") || ts.includes("action") || ts === "draft") return 1
  return 0
}

/** Build vertical timeline step states for the admin porting desk. */
export function buildAdminPortingPipeline(order: PortingOrder): AdminPortingPipelineStep[] {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  const failed =
    order.status === "rejected" ||
    ts.includes("rejected") ||
    ts.includes("failed") ||
    ts.includes("cancelled") ||
    ts.includes("canceled")
  const active = activePipelineIndex(order)

  return PIPELINE_DEF.map((step, idx) => {
    let state: AdminPortingPipelineStepState = "upcoming"
    if (failed && idx === active) state = "failed"
    else if (idx < active) state = "complete"
    else if (idx === active) state = "current"
    return { ...step, state }
  })
}
