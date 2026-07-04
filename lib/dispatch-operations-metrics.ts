// Live dispatch counters for the scheduler operations metric strip.

import { dayKeyLocal } from "@/lib/scheduler-utils"
import { isActivePipelineFeedJob, schedulerLifecyclePhase } from "@/lib/scheduler-job-status"
import type { ActivePipelineJob, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

/** One row of live dispatch KPIs for the selected day. */
export type DispatchOperationsMetrics = {
  activeDispatches: number
  unassignedPool: number
  onSite: number
  completedToday: number
}

type JobLike = {
  id: string
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
  completed_at?: string | null
}

function phaseFor(job: JobLike) {
  return schedulerLifecyclePhase({
    job_status: job.job_status,
    dispatch_status: job.dispatch_status,
    assigned_tech_id: job.assigned_tech_id,
  })
}

function isCompletedStatus(job: JobLike): boolean {
  return (job.job_status ?? "").trim().toLowerCase() === "completed"
}

function resolveCompletedAt(job: JobLike, ledgerAt?: string): string | null {
  if (ledgerAt?.trim()) return ledgerAt
  if (job.completed_at?.trim()) return job.completed_at
  return null
}

/** Count completed jobs whose completion timestamp falls on `todayKey` (local calendar day). */
export function countCompletedTodayJobs(params: {
  rawCalendarJobs: readonly JobLike[]
  todayKey: string
  completedTodayLedger?: ReadonlyMap<string, string>
}): number {
  const seen = new Set<string>()
  let count = 0

  for (const job of params.rawCalendarJobs) {
    if (!isCompletedStatus(job)) continue
    const completedAt = resolveCompletedAt(job, params.completedTodayLedger?.get(job.id))
    if (!completedAt) continue
    if (dayKeyLocal(new Date(completedAt)) !== params.todayKey) continue
    if (seen.has(job.id)) continue
    seen.add(job.id)
    count += 1
  }

  if (params.completedTodayLedger) {
    for (const [jobId, completedAt] of params.completedTodayLedger) {
      if (seen.has(jobId)) continue
      if (dayKeyLocal(new Date(completedAt)) !== params.todayKey) continue
      seen.add(jobId)
      count += 1
    }
  }

  return count
}

/** Merge pipeline + calendar rows without double-counting the same lead id. */
function mergedActiveJobs(
  activePipelineJobs: ActivePipelineJob[],
  dayEvents: SchedulerEvent[]
): JobLike[] {
  const byId = new Map<string, JobLike>()
  for (const job of activePipelineJobs) byId.set(job.id, job)
  for (const ev of dayEvents) {
    if (isCompletedStatus(ev)) continue
    byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

/** Compute KPIs for the operations banner (client-safe, no I/O). */
export function computeDispatchOperationsMetrics(params: {
  poolJobs: UnassignedPoolJob[]
  activePipelineJobs: ActivePipelineJob[]
  /** Selected-day timeline rows (completed jobs may be omitted). */
  dayEvents: SchedulerEvent[]
  /** Raw bootstrap calendar payload — includes completed rows hidden from the timeline. */
  rawCalendarJobs?: readonly SchedulerEvent[]
  /** Local calendar day key (YYYY-MM-DD) for the Done counter. */
  todayKey?: string
  /** Optimistic completion timestamps keyed by job id. */
  completedTodayLedger?: ReadonlyMap<string, string>
}): DispatchOperationsMetrics {
  const assignedPipelineJobs = params.activePipelineJobs.filter(isActivePipelineFeedJob)
  const merged = mergedActiveJobs(assignedPipelineJobs, params.dayEvents)
  const todayKey = params.todayKey ?? dayKeyLocal(new Date())
  const rawCalendarJobs = params.rawCalendarJobs ?? params.dayEvents

  let activeDispatches = 0
  let onSite = 0

  for (const job of merged) {
    const phase = phaseFor(job)
    if (phase === "scheduled" || phase === "en_route" || phase === "on_site") {
      activeDispatches += 1
    }
    if (phase === "on_site") onSite += 1
  }

  return {
    activeDispatches,
    unassignedPool: params.poolJobs.length,
    onSite,
    completedToday: countCompletedTodayJobs({
      rawCalendarJobs,
      todayKey,
      completedTodayLedger: params.completedTodayLedger,
    }),
  }
}
