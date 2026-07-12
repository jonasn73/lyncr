// Real-time appointment interaction states for dispatch overview + hopper cards.

export type ScheduleInteractionPhase = "none" | "upcoming" | "active" | "overdue" | "completed"

const UPCOMING_LEAD_MINUTES = 30
const OVERDUE_LAG_MINUTES = 30
const ACTIVE_GRACE_MINUTES = 15

/** Resolve scheduled ISO from scheduler event or hopper pool job shapes. */
export function resolveJobScheduledAtIso(job: {
  scheduled_at?: string | null
  scheduled_tentative?: boolean
}): string | null {
  const raw = job.scheduled_at?.trim()
  if (!raw) return null
  if (job.scheduled_tentative) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return raw
}

/** End of the active window: later of (scheduled + 15m) or end of scheduled clock hour. */
export function scheduleInteractionActiveUntilMs(scheduled: Date): number {
  const hourEnd = new Date(scheduled)
  hourEnd.setHours(scheduled.getHours() + 1, 0, 0, 0)
  const graceEnd = scheduled.getTime() + ACTIVE_GRACE_MINUTES * 60_000
  return Math.max(hourEnd.getTime(), graceEnd)
}

/** Compare `now` to a job's scheduled time and return a dispatcher interaction phase. */
export function resolveScheduleInteractionPhase(params: {
  now: Date
  scheduled_at: string | null | undefined
  job_status?: string | null
}): ScheduleInteractionPhase {
  const status = (params.job_status ?? "").trim().toLowerCase()
  if (status === "completed") return "completed"
  // Close-outs should not keep flashing overdue on the board.
  if (
    status === "cancelled" ||
    status === "canceled" ||
    status === "unresolved" ||
    status === "referred"
  ) {
    return "completed"
  }
  if (status === "en_route" || status === "arrived") return "active"

  const iso = params.scheduled_at?.trim()
  if (!iso) return "none"

  const scheduled = new Date(iso)
  if (Number.isNaN(scheduled.getTime())) return "none"

  const nowMs = params.now.getTime()
  const startMs = scheduled.getTime()
  const minutesUntil = (startMs - nowMs) / 60_000
  const minutesAfter = (nowMs - startMs) / 60_000

  if (minutesAfter >= OVERDUE_LAG_MINUTES) return "overdue"
  if (nowMs >= startMs && nowMs <= scheduleInteractionActiveUntilMs(scheduled)) return "active"
  if (minutesUntil > 0 && minutesUntil <= UPCOMING_LEAD_MINUTES) return "upcoming"
  return "none"
}

export const SCHEDULE_INTERACTION_LABEL: Record<
  Exclude<ScheduleInteractionPhase, "none" | "completed">,
  string
> = {
  upcoming: "⚠️ UPCOMING (Next 30m)",
  active: "⚡ ACTIVE NOW",
  overdue: "🚨 OVERDUE / DELAYED",
}

export const SCHEDULE_INTERACTION_BADGE_CLASS: Record<
  Exclude<ScheduleInteractionPhase, "none" | "completed">,
  string
> = {
  upcoming:
    "animate-pulse rounded-full border border-orange-500/50 bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-200 shadow-[0_0_10px_rgba(249,115,22,0.35)]",
  active:
    "animate-pulse rounded-full border border-emerald-400/60 bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.55)]",
  overdue:
    "rounded-full border border-red-500/70 bg-red-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.45)]",
}
