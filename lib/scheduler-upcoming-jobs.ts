// Upcoming jobs for the dispatch live status bar (client-safe, no I/O).

import { schedulerLifecyclePhase, type SchedulerLifecyclePhase } from "@/lib/scheduler-job-status"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

export type UpcomingSchedulerJob = {
  id: string
  customer_name: string | null
  scheduled_at: string | null
  job_type: string | null
  phase: SchedulerLifecyclePhase
  assigned_tech_name: string | null
  /** En route or on-site — shown first in the list. */
  isActiveNow: boolean
}

type JobSource = {
  id: string
  customer_name: string | null
  scheduled_at: string | null
  job_type: string | null
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
  assigned_tech_name?: string | null
}

function phaseFor(job: JobSource): SchedulerLifecyclePhase {
  return schedulerLifecyclePhase({
    job_status: job.job_status,
    dispatch_status: job.dispatch_status,
    assigned_tech_id: job.assigned_tech_id,
  })
}

function scheduledOnDay(iso: string | null, day: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return dayKeyLocal(d) === dayKeyLocal(day)
}

function mergeDayJobs(
  activePipelineJobs: ActivePipelineJob[],
  dayEvents: SchedulerEvent[],
  poolJobs: UnassignedPoolJob[]
): JobSource[] {
  const byId = new Map<string, JobSource>()
  for (const job of poolJobs) byId.set(job.id, job)
  for (const job of activePipelineJobs) byId.set(job.id, job)
  for (const ev of dayEvents) byId.set(ev.id, ev)
  return [...byId.values()]
}

/** Pool + pipeline rows for mobile list — pipeline wins when the same id exists in both. */
export function mergeSchedulerListJobs(
  activePipelineJobs: ActivePipelineJob[],
  poolJobs: UnassignedPoolJob[]
): ActivePipelineJob[] {
  const byId = new Map<string, ActivePipelineJob>()
  for (const job of poolJobs) {
    byId.set(job.id, {
      ...job,
      job_status: null,
      assigned_tech_id: null,
      assigned_tech_name: null,
    })
  }
  for (const job of activePipelineJobs) {
    byId.set(job.id, job)
  }
  return [...byId.values()]
}

/** Non-completed jobs for the selected day, sorted for the "coming up next" strip. */
export function listUpcomingSchedulerJobs(params: {
  now: Date
  selectedDay: Date
  activePipelineJobs: ActivePipelineJob[]
  dayEvents: SchedulerEvent[]
  poolJobs: UnassignedPoolJob[]
  limit?: number
}): UpcomingSchedulerJob[] {
  const limit = params.limit ?? 5
  const selectedKey = dayKeyLocal(params.selectedDay)
  const todayKey = dayKeyLocal(params.now)
  const isToday = selectedKey === todayKey
  const isFutureDay = selectedKey > todayKey

  if (!isToday && !isFutureDay) return []

  const merged = mergeDayJobs(params.activePipelineJobs, params.dayEvents, params.poolJobs)
  const candidates: UpcomingSchedulerJob[] = []

  for (const job of merged) {
    const phase = phaseFor(job)
    if (phase === "completed") continue

    const onSelectedDay =
      scheduledOnDay(job.scheduled_at, params.selectedDay) ||
      (isToday && !job.scheduled_at && phase === "unassigned")

    if (!onSelectedDay) continue

    const isActiveNow = phase === "en_route" || phase === "on_site"

    candidates.push({
      id: job.id,
      customer_name: job.customer_name,
      scheduled_at: job.scheduled_at,
      job_type: job.job_type,
      phase,
      assigned_tech_name: job.assigned_tech_name ?? null,
      isActiveNow,
    })
  }

  candidates.sort((a, b) => {
    if (a.isActiveNow !== b.isActiveNow) return a.isActiveNow ? -1 : 1
    const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
    const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
    return ta - tb
  })

  return candidates.slice(0, limit)
}

export function formatUpcomingJobTime(iso: string | null): string {
  if (!iso) return "Unscheduled"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** True when Mark Done is invalid — job is still unassigned or has no start time. */
export function upcomingJobNeedsDispatch(job: {
  phase: SchedulerLifecyclePhase
  scheduled_at: string | null
}): boolean {
  // Unassigned pool / no tech yet.
  if (job.phase === "unassigned") return true
  // Scheduled_at missing means the job is still "Unscheduled".
  if (!job.scheduled_at?.trim()) return true
  return false
}
