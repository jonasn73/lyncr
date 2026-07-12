// Pick the best active job match for an inbound caller (client-safe).

import { formatUnknownCallerCnamToken } from "@/lib/cnam-token-framework"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import type { SchedulerEvent, SchedulerPhoneLookupResult, UnassignedPoolJob } from "@/lib/types"

export type CallerContextMatch =
  | {
      kind: "active_job"
      jobId: string
      customerName: string
      vehicleLabel: string | null
      metaLine: string
    }
  | {
      kind: "unknown"
      cnamToken: string
    }

type JobLike = {
  id: string
  customer_name: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  job_status?: string | null
  dispatch_status?: string | null
  scheduled_at?: string | null
  created_at?: string
}

function isTerminalJob(job: JobLike): boolean {
  const status = (job.job_status ?? "").trim().toLowerCase()
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "unresolved" ||
    status === "referred"
  )
}

function scoreJob(job: JobLike, nowMs: number): number {
  if (isTerminalJob(job)) return -1
  const status = (job.job_status ?? "").trim().toLowerCase()
  if (status === "en_route" || status === "arrived") return 100
  if ((job.dispatch_status ?? "").toUpperCase() === "DISPATCHED") return 80
  if (job.scheduled_at) {
    const t = new Date(job.scheduled_at).getTime()
    if (Number.isFinite(t) && Math.abs(t - nowMs) < 48 * 60 * 60 * 1000) return 60
  }
  return 40
}

function toJobLike(job: UnassignedPoolJob | SchedulerEvent): JobLike {
  return {
    id: job.id,
    customer_name: job.customer_name,
    vehicle_year: job.vehicle_year,
    vehicle_make: job.vehicle_make,
    vehicle_model: job.vehicle_model,
    job_status: "job_status" in job ? job.job_status : null,
    dispatch_status: job.dispatch_status,
    scheduled_at: job.scheduled_at,
    created_at: job.created_at,
  }
}

/** Resolve Condition A (active job) or Condition B (CNAM unknown) for the intake header. */
export function resolveCallerContext(
  phone: string,
  lookup: SchedulerPhoneLookupResult | null | undefined,
  now: Date = new Date()
): CallerContextMatch {
  const nowMs = now.getTime()
  const candidates: JobLike[] = []
  if (lookup) {
    for (const job of lookup.pool) candidates.push(toJobLike(job))
    for (const job of lookup.scheduled) candidates.push(toJobLike(job))
  }

  let best: JobLike | null = null
  let bestScore = -1
  for (const job of candidates) {
    const score = scoreJob(job, nowMs)
    if (score > bestScore) {
      bestScore = score
      best = job
    }
  }

  if (best && bestScore >= 40) {
    const customerName = best.customer_name?.trim() || "Customer"
    const vehicleLabel =
      vehicleLabelFromParts(best.vehicle_year ?? null, best.vehicle_make ?? null, best.vehicle_model ?? null) ||
      null
    const metaLine = [customerName, vehicleLabel].filter(Boolean).join(" • ")
    return {
      kind: "active_job",
      jobId: best.id,
      customerName,
      vehicleLabel,
      metaLine,
    }
  }

  return {
    kind: "unknown",
    cnamToken: formatUnknownCallerCnamToken(phone),
  }
}
