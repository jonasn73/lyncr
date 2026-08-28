// Shared job lifecycle styling for scheduler cards, lists, and map markers.

import {
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INTERACTIVE_HOVER,
  SCHEDULER_LIST_CARD_SHELL,
} from "@/lib/scheduler-ui-tokens"

export { SCHEDULER_LIST_CARD_SHELL }

/** Louisville, KY — default map center for Key Squad / local field ops. */
export const LOUISVILLE_MAP_CENTER = { lat: 38.2527, lng: -85.7585 } as const
export const LOUISVILLE_DEFAULT_ZOOM = 11

export type SchedulerLifecyclePhase =
  | "unassigned"
  | "scheduled"
  | "en_route"
  | "on_site"
  | "paused"
  | "completed"

/**
 * Single human lifecycle for operators (JobDetail / Coming Up / CRM).
 * Internal columns (job_status / dispatch_status / disposition) stay as writers only.
 */
export type OperatorJobPhase =
  | "quote"
  | "in_pool"
  | "scheduled"
  | "en_route"
  | "on_site"
  | "paused"
  | "done"
  | "cancelled"
  | "referred"
  | "unresolved"

export type OperatorJobPhaseInput = {
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
  /** Optional — quote leads when disposition is still lead/PENDING_TIME. */
  disposition?: string | null
  scheduled_at?: string | null
}

/** True when the tech paused mid-job (wait on site or waiting on parts). */
export function isPausedJobStatus(jobStatus?: string | null): boolean {
  const status = (jobStatus ?? "").trim().toLowerCase()
  return status === "paused_wait" || status === "paused_parts"
}

/** Terminal close-outs — never show Waiting Pool / In pool after these. */
export function isTerminalOperatorJobStatus(jobStatus?: string | null): boolean {
  const status = (jobStatus ?? "").trim().toLowerCase()
  return (
    status === "completed" ||
    status === "done" ||
    status === "paid" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "unresolved" ||
    status === "referred"
  )
}

/** One operator-facing phase — reconciles leftover pool dispatch after complete. */
export function resolveOperatorJobPhase(params: OperatorJobPhaseInput): OperatorJobPhase {
  const status = (params.job_status ?? "").trim().toLowerCase()
  const dispatch = (params.dispatch_status ?? "").trim().toLowerCase()
  const disposition = (params.disposition ?? "").trim().toLowerCase()

  // job_status wins for terminals so stale unassigned_pool never reads as In pool.
  if (status === "completed" || status === "done" || status === "paid") return "done"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (status === "referred") return "referred"
  if (status === "unresolved") return "unresolved"
  if (
    dispatch === "completed" ||
    dispatch === "cancelled" ||
    dispatch === "canceled" ||
    dispatch === "referred" ||
    dispatch === "unresolved"
  ) {
    if (dispatch === "completed") return "done"
    if (dispatch === "referred") return "referred"
    if (dispatch === "unresolved") return "unresolved"
    return "cancelled"
  }

  if (isPausedJobStatus(status)) return "paused"
  if (status === "arrived" || status === "on_site") return "on_site"
  if (status === "en_route") return "en_route"

  // Open quote / callback / price-denied salvage — CRM Recover, not hopper.
  if (
    dispatch === "lead" ||
    dispatch === "lost_lead" ||
    dispatch === "unassigned_callback" ||
    dispatch === "salvage_pending" ||
    disposition === "lead" ||
    disposition === "pending_time" ||
    disposition === "price_rejected" ||
    status === "lead" ||
    status.includes("price")
  ) {
    return "quote"
  }

  if (
    dispatch === "unassigned_pool" ||
    status === "unassigned" ||
    !params.assigned_tech_id?.trim()
  ) {
    return "in_pool"
  }

  return "scheduled"
}

/** Human copy only — never expose raw enums to operators. */
export const OPERATOR_JOB_PHASE_LABEL: Record<OperatorJobPhase, string> = {
  quote: "Quote",
  in_pool: "In pool",
  scheduled: "Scheduled",
  en_route: "En route",
  on_site: "On site",
  paused: "Paused",
  done: "Done",
  cancelled: "Cancelled",
  referred: "Referred",
  unresolved: "Unresolved",
}

export const OPERATOR_JOB_PHASE_BADGE_STYLE: Record<OperatorJobPhase, string> = {
  quote: "border-warning/40 bg-warning/10 text-warning",
  in_pool: "border-warning/40 bg-warning/10 text-warning",
  scheduled: "border-primary/40 bg-primary/10 text-primary",
  en_route: "border-info/40 bg-info/10 text-info",
  on_site: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  paused: "border-warning/40 bg-warning/10 text-warning",
  done: "border-success/40 bg-success/10 text-success",
  cancelled: "border-border/40 bg-accent/20 text-muted-foreground",
  referred: "border-operator/40 bg-operator/10 text-operator",
  unresolved: "border-border/40 bg-accent/20 text-muted-foreground",
}

/** Map operator phase → existing scheduler board phase (cards / map pins). */
export function operatorPhaseToSchedulerPhase(
  phase: OperatorJobPhase
): SchedulerLifecyclePhase {
  switch (phase) {
    case "done":
    case "cancelled":
    case "referred":
    case "unresolved":
      return "completed"
    case "quote":
    case "in_pool":
      return "unassigned"
    case "en_route":
      return "en_route"
    case "on_site":
      return "on_site"
    case "paused":
      return "paused"
    case "scheduled":
    default:
      return "scheduled"
  }
}

/** Derive UI phase from dispatch + field progress columns. */
export function schedulerLifecyclePhase(params: {
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
}): SchedulerLifecyclePhase {
  // Prefer the operator resolver so done/paid never map to unassigned/pool.
  return operatorPhaseToSchedulerPhase(resolveOperatorJobPhase(params))
}

type SchedulerJobPhaseInput = {
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
}

/** Hopper-only ticket — no tech yet or still in the unassigned pool. */
export function isHopperPoolJob(job: SchedulerJobPhaseInput): boolean {
  return schedulerLifecyclePhase(job) === "unassigned"
}

/** Right-column active pipeline — assigned, scheduled, en route, on site, or paused. */
export function isActivePipelineFeedJob(job: SchedulerJobPhaseInput): boolean {
  const phase = schedulerLifecyclePhase(job)
  return phase === "scheduled" || phase === "en_route" || phase === "on_site" || phase === "paused"
}

export const SCHEDULER_BADGE_STYLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "border-warning/40 bg-warning/10 text-warning",
  scheduled: "border-primary/40 bg-primary/10 text-primary",
  en_route: "border-info/40 bg-info/10 text-info",
  on_site: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  paused: "border-warning/40 bg-warning/10 text-warning",
  completed: "border-border/40 bg-accent/20 text-muted-foreground",
}

/** Tailwind classes for hourly grid blocks + day summary chips (glass + phase accent). */
export const SCHEDULER_CARD_STYLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-amber-500 text-warning`,
  scheduled: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-teal-500 text-primary`,
  en_route: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-sky-500 text-info`,
  on_site: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-yellow-500 text-yellow-100`,
  paused: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-orange-500 text-warning`,
  completed: `${SCHEDULER_GLASS_CARD} border-l-4 border-l-zinc-600 text-muted-foreground opacity-70`,
}

/** Hover for tappable swimlane / timeline appointment blocks. */
export const SCHEDULER_TIMELINE_CARD_HOVER = SCHEDULER_INTERACTIVE_HOVER

export const SCHEDULER_STATUS_LABEL: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "In pool",
  scheduled: "Scheduled",
  en_route: "En route",
  on_site: "On site",
  paused: "Paused",
  completed: "Done",
}

/** Human label for the raw job_status column (covers close-out statuses). */
export function schedulerJobStatusDisplayLabel(jobStatus?: string | null): string | null {
  const status = (jobStatus ?? "").trim().toLowerCase()
  if (!status) return null
  if (status === "cancelled" || status === "canceled") return "Cancelled"
  if (status === "unresolved") return "Unresolved"
  if (status === "referred") return "Referred"
  if (status === "completed" || status === "done" || status === "paid") return "Done"
  if (status === "arrived" || status === "on_site") return "On site"
  if (status === "en_route") return "En route"
  if (status === "paused_wait") return "Paused — waiting"
  if (status === "paused_parts") return "Paused — parts"
  if (status === "assigned") return "Scheduled"
  if (status === "unassigned") return "In pool"
  return null
}

/** Convenience: one human status string for drawers / chips / CRM. */
export function operatorJobPhaseLabel(params: OperatorJobPhaseInput): string {
  return OPERATOR_JOB_PHASE_LABEL[resolveOperatorJobPhase(params)]
}

/** Left-panel group order for the dispatch split view (most urgent first). */
export const PIPELINE_PANEL_GROUP_ORDER: SchedulerLifecyclePhase[] = [
  "en_route",
  "on_site",
  "paused",
  "scheduled",
  "unassigned",
]

export const PIPELINE_PANEL_GROUP_TITLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "In pool",
  scheduled: "Scheduled",
  en_route: "En route",
  on_site: "On site",
  paused: "Paused",
  completed: "Done",
}

/** Pin fill color for numbered route stops on the map. */
export const SCHEDULER_MAP_PIN_COLOR: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "#f97316",
  scheduled: "#14b8a6",
  en_route: "#38bdf8",
  on_site: "#eab308",
  paused: "#f97316",
  completed: "#22c55e",
}

export function isActiveMapJob(phase: SchedulerLifecyclePhase): boolean {
  return phase !== "completed"
}

/** Completed jobs render as a faint checkmark instead of a route stop. */
export function isCompletedMapJob(phase: SchedulerLifecyclePhase): boolean {
  return phase === "completed"
}
