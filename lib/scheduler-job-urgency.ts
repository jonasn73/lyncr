// Time-based urgency for dispatch job cards and upcoming strips.

import type { SchedulerLifecyclePhase } from "@/lib/scheduler-job-status"
import { SCHEDULER_GLASS_CARD, SCHEDULER_INTERACTIVE_HOVER } from "@/lib/scheduler-ui-tokens"

/** Glass chip base shared by upcoming-job strips and urgency accents. */
const URGENCY_CHIP_GLASS = [
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INTERACTIVE_HOVER,
  "rounded-lg",
].join(" ")

export type SchedulerJobUrgency =
  | "active_now"
  | "overdue"
  | "imminent"
  | "soon"
  | "later"
  | "unscheduled"

const DEFAULT_IMMINENT_MINUTES = 30
const DEFAULT_SOON_MINUTES = 90

/** Classify how soon a job needs attention (client-safe). */
export function resolveSchedulerJobUrgency(params: {
  now: Date
  scheduled_at: string | null
  phase: SchedulerLifecyclePhase
  imminentMinutes?: number
  soonMinutes?: number
}): SchedulerJobUrgency {
  const imminentMinutes = params.imminentMinutes ?? DEFAULT_IMMINENT_MINUTES
  const soonMinutes = params.soonMinutes ?? DEFAULT_SOON_MINUTES

  if (params.phase === "en_route" || params.phase === "on_site") return "active_now"
  if (params.phase === "completed") return "later"

  if (!params.scheduled_at) return "unscheduled"

  const startMs = new Date(params.scheduled_at).getTime()
  if (Number.isNaN(startMs)) return "unscheduled"

  const minutesUntil = (startMs - params.now.getTime()) / 60_000
  if (minutesUntil < 0) return "overdue"
  if (minutesUntil <= imminentMinutes) return "imminent"
  if (minutesUntil <= soonMinutes) return "soon"
  return "later"
}

/** Human countdown for the job time row (e.g. "In 47m", "12m overdue"). */
export function formatSchedulerJobCountdown(now: Date, scheduled_at: string | null): string | null {
  if (!scheduled_at) return null
  const startMs = new Date(scheduled_at).getTime()
  if (Number.isNaN(startMs)) return null

  const minutesUntil = Math.round((startMs - now.getTime()) / 60_000)
  if (minutesUntil < 0) {
    const overdue = Math.abs(minutesUntil)
    if (overdue < 60) return `${overdue}m overdue`
    const h = Math.floor(overdue / 60)
    const m = overdue % 60
    return m > 0 ? `${h}h ${m}m overdue` : `${h}h overdue`
  }
  if (minutesUntil === 0) return "Starting now"
  if (minutesUntil < 60) return `In ${minutesUntil}m`
  const h = Math.floor(minutesUntil / 60)
  const m = minutesUntil % 60
  return m > 0 ? `In ${h}h ${m}m` : `In ${h}h`
}

export const SCHEDULER_URGENCY_LABEL: Record<SchedulerJobUrgency, string> = {
  active_now: "In progress",
  overdue: "Overdue",
  imminent: "Starting soon",
  soon: "Coming up",
  later: "Scheduled",
  unscheduled: "Unscheduled",
}

/** Chip / card shell accents for each urgency level. */
export const SCHEDULER_URGENCY_CHIP_CLASS: Record<SchedulerJobUrgency, string> = {
  active_now: `${URGENCY_CHIP_GLASS} border-yellow-500/55 ring-1 ring-yellow-500/25`,
  overdue: `${URGENCY_CHIP_GLASS} border-red-500/55 ring-1 ring-red-500/30`,
  imminent: `${URGENCY_CHIP_GLASS} border-orange-500/55 ring-1 ring-orange-500/30 animate-pulse`,
  soon: `${URGENCY_CHIP_GLASS} border-amber-500/45 ring-1 ring-amber-500/20`,
  later: URGENCY_CHIP_GLASS,
  unscheduled: URGENCY_CHIP_GLASS,
}

export const SCHEDULER_URGENCY_TIME_CLASS: Record<SchedulerJobUrgency, string> = {
  active_now: "text-yellow-300",
  overdue: "text-red-300",
  imminent: "text-orange-300",
  soon: "text-amber-300",
  later: "text-primary",
  unscheduled: "text-zinc-500",
}

/** Left border accent on full job list cards. */
export const SCHEDULER_URGENCY_CARD_BORDER_CLASS: Record<SchedulerJobUrgency, string> = {
  active_now: "border-l-4 border-l-yellow-500",
  overdue: "border-l-4 border-l-red-500",
  imminent: "border-l-4 border-l-orange-500",
  soon: "border-l-4 border-l-amber-500",
  later: "border-l-4 border-l-transparent",
  unscheduled: "border-l-4 border-l-zinc-600",
}
