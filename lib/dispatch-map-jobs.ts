// Shared helpers for Live Dispatch Map pins (Activities tab + Map tab).

import type { DispatchJob, UnassignedPoolJob } from "@/lib/types"
import {
  CRM_LEAD_STATUS,
  LOST_LEAD_STATUS,
  UNASSIGNED_CALLBACK_STATUS,
} from "@/lib/job-pool"

/** Terminal / non-dispatch statuses that must never render as map pins. */
const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "unresolved",
  "referred",
  "lead",
  "lost_lead",
])

/** CRM / quote / callback leads — not open field work. */
const NON_DISPATCH_STATUSES = new Set([
  CRM_LEAD_STATUS,
  LOST_LEAD_STATUS,
  UNASSIGNED_CALLBACK_STATUS,
])

/** Coerce API lat/lng (number or numeric string) into finite coordinates. */
export function coerceMapCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/**
 * True when a job should appear on the Live Dispatch Map.
 * Open hopper + assigned field work only — not quote leads or closed history.
 */
export function isActiveDispatchMapJob(job: {
  job_status?: string | null
  assigned_tech_id?: string | null
  dispatch_status?: string | null
  location?: string | null
  summary?: string | null
}): boolean {
  const status = (job.job_status ?? "").trim().toLowerCase()
  if (status && TERMINAL_JOB_STATUSES.has(status)) return false

  const dispatch = (job.dispatch_status ?? "").trim().toLowerCase()
  if (dispatch && NON_DISPATCH_STATUSES.has(dispatch)) return false

  // Quote-lead notes / placeholder addresses are never field pins.
  const location = (job.location ?? "").trim().toUpperCase()
  if (location === "PENDING_CALLBACK" || location === "CALLBACK") return false
  const summary = (job.summary ?? "").toLowerCase()
  if (summary.includes("price quoted / lead only")) return false

  return true
}

/** Normalize booked API rows and drop non-plottable / inactive work. */
export function normalizeDispatchJob(job: DispatchJob): DispatchJob | null {
  if (!isActiveDispatchMapJob(job)) return null
  return {
    ...job,
    latitude: coerceMapCoord(job.latitude),
    longitude: coerceMapCoord(job.longitude),
  }
}

/** Hopper / pool row → DispatchJob shape for map pins. */
export function poolJobToDispatchJob(job: UnassignedPoolJob): DispatchJob | null {
  const mapped: DispatchJob = {
    id: job.id,
    customer_name: job.customer_name,
    customer_phone: job.customer_phone,
    location: job.location,
    summary: job.summary,
    job_status: "UNASSIGNED",
    assigned_tech_id: null,
    assigned_tech_name: null,
    latitude: coerceMapCoord(job.latitude),
    longitude: coerceMapCoord(job.longitude),
    created_at: job.created_at,
    vehicle_year: job.vehicle_year,
    vehicle_make: job.vehicle_make,
    vehicle_model: job.vehicle_model,
  }
  if (!isActiveDispatchMapJob({ ...mapped, dispatch_status: job.dispatch_status })) {
    return null
  }
  return mapped
}

/** Merge booked + hopper jobs; prefer rows that already have coordinates. */
export function mergeDispatchMapJobs(
  booked: DispatchJob[],
  pool: UnassignedPoolJob[]
): DispatchJob[] {
  const byId = new Map<string, DispatchJob>()
  for (const raw of booked) {
    const job = normalizeDispatchJob(raw)
    if (job) byId.set(job.id, job)
  }
  for (const raw of pool) {
    const job = poolJobToDispatchJob(raw)
    if (!job) continue
    const prev = byId.get(job.id)
    if (!prev) {
      byId.set(job.id, job)
      continue
    }
    const preferPool =
      (prev.latitude == null || prev.longitude == null) &&
      job.latitude != null &&
      job.longitude != null
    byId.set(job.id, {
      ...prev,
      ...(preferPool ? { latitude: job.latitude, longitude: job.longitude } : {}),
      vehicle_year: prev.vehicle_year || job.vehicle_year,
      vehicle_make: prev.vehicle_make || job.vehicle_make,
      vehicle_model: prev.vehicle_model || job.vehicle_model,
      location: prev.location || job.location,
      assigned_tech_id: prev.assigned_tech_id,
      assigned_tech_name: prev.assigned_tech_name,
    })
  }
  return [...byId.values()]
}
