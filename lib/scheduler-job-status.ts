// Shared job lifecycle styling for scheduler cards, lists, and map markers.

/** Louisville, KY — default map center for Key Squad / local field ops. */
export const LOUISVILLE_MAP_CENTER = { lat: 38.2527, lng: -85.7585 } as const
export const LOUISVILLE_DEFAULT_ZOOM = 11

export type SchedulerLifecyclePhase =
  | "unassigned"
  | "scheduled"
  | "en_route"
  | "on_site"
  | "completed"

/** Derive UI phase from dispatch + field progress columns. */
export function schedulerLifecyclePhase(params: {
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
}): SchedulerLifecyclePhase {
  const status = (params.job_status ?? "").trim().toLowerCase()
  if (status === "completed") return "completed"
  if (status === "arrived") return "on_site"
  if (status === "en_route") return "en_route"
  if (status === "unassigned") return "unassigned"
  const dispatch = (params.dispatch_status ?? "").trim().toLowerCase()
  if (dispatch === "unassigned_pool" || !params.assigned_tech_id?.trim()) return "unassigned"
  return "scheduled"
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

/** Right-column active pipeline — assigned, scheduled, en route, or on site. */
export function isActivePipelineFeedJob(job: SchedulerJobPhaseInput): boolean {
  const phase = schedulerLifecyclePhase(job)
  return phase === "scheduled" || phase === "en_route" || phase === "on_site"
}

export const SCHEDULER_BADGE_STYLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  scheduled: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  en_route: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  on_site: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  completed: "border-zinc-600/40 bg-zinc-700/20 text-zinc-400",
}

/** Subtle list-card shell — phase color only on the status badge, not the whole row. */
export const SCHEDULER_LIST_CARD_SHELL =
  "relative w-full rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-3 pb-9 pt-3 text-left transition-colors hover:bg-zinc-900/50"

/** Tailwind classes for hourly grid blocks + day summary chips. */
export const SCHEDULER_CARD_STYLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "border-amber-500/50 bg-amber-500/15 text-amber-100",
  scheduled: "border-teal-500/50 bg-teal-500/15 text-teal-50",
  en_route: "border-sky-500/50 bg-sky-500/15 text-sky-100",
  on_site: "border-yellow-500/50 bg-yellow-500/15 text-yellow-100",
  completed: "border-zinc-600/50 bg-zinc-700/30 text-zinc-400 opacity-70",
}

export const SCHEDULER_STATUS_LABEL: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "Unassigned",
  scheduled: "Assigned",
  en_route: "En route",
  on_site: "In progress",
  completed: "Completed",
}

/** Left-panel group order for the dispatch split view (most urgent first). */
export const PIPELINE_PANEL_GROUP_ORDER: SchedulerLifecyclePhase[] = [
  "en_route",
  "on_site",
  "scheduled",
  "unassigned",
]

export const PIPELINE_PANEL_GROUP_TITLE: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "Unassigned",
  scheduled: "Assigned",
  en_route: "En route",
  on_site: "In progress",
  completed: "Completed",
}

/** Pin fill color for numbered route stops on the map. */
export const SCHEDULER_MAP_PIN_COLOR: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "#f97316",
  scheduled: "#14b8a6",
  en_route: "#38bdf8",
  on_site: "#eab308",
  completed: "#22c55e",
}

export function isActiveMapJob(phase: SchedulerLifecyclePhase): boolean {
  return phase !== "completed"
}

/** Completed jobs render as a faint checkmark instead of a route stop. */
export function isCompletedMapJob(phase: SchedulerLifecyclePhase): boolean {
  return phase === "completed"
}
