// Job pipeline status labels and helpers for the scheduler overview dispatch controller.

import { neighborhoodFromLocation } from "@/lib/job-pool"
import type { SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

/** Structural dispatch_status values exposed in the overview pipeline dropdown. */
export type JobPipelineStatusId =
  | "unassigned_pool"
  | "DISPATCHED"
  | "awaiting_time"
  | "salvage_pending"

/** One row in the job-status dropdown (id maps to dispatch_status). */
export type JobPipelineStatusOption = {
  id: JobPipelineStatusId
  label: string
}

/** Dropdown options shown in Job Pipeline Control (overview drawer). */
export const JOB_PIPELINE_STATUS_OPTIONS: JobPipelineStatusOption[] = [
  { id: "unassigned_pool", label: "Unassigned / Waiting Pool" },
  { id: "DISPATCHED", label: "Scheduled (Time/Location Locked)" },
  { id: "awaiting_time", label: "Needs Follow Up" },
  { id: "salvage_pending", label: "Price Denied (Outreach / Lower Price Offer)" },
]

/** Infer the pipeline dropdown value from stored job columns. */
export function pipelineStatusFromJob(params: {
  dispatch_status?: string | null
  assigned_tech_id?: string | null
}): JobPipelineStatusId {
  const dispatch = (params.dispatch_status ?? "").trim().toLowerCase()
  if (dispatch === "salvage_pending") return "salvage_pending"
  if (dispatch === "awaiting_time") return "awaiting_time"
  if (dispatch === "dispatched" || Boolean(params.assigned_tech_id?.trim())) return "DISPATCHED"
  return "unassigned_pool"
}

/** Database patch for a pipeline dropdown selection. */
export function pipelineStatusPatch(status: JobPipelineStatusId): {
  dispatch_status: string
  is_salvageable: boolean
} {
  switch (status) {
    case "unassigned_pool":
      return { dispatch_status: "unassigned_pool", is_salvageable: false }
    case "DISPATCHED":
      return { dispatch_status: "DISPATCHED", is_salvageable: false }
    case "awaiting_time":
      return { dispatch_status: "awaiting_time", is_salvageable: false }
    case "salvage_pending":
      return { dispatch_status: "salvage_pending", is_salvageable: true }
  }
}

/** Human label for a pipeline status id. */
export function pipelineStatusLabel(status: JobPipelineStatusId): string {
  return JOB_PIPELINE_STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status
}

/** Short pill label for the Active Job header. */
export function pipelineStatusPillLabel(status: JobPipelineStatusId): string {
  switch (status) {
    case "unassigned_pool":
      return "Waiting Pool"
    case "DISPATCHED":
      return "Dispatched"
    case "awaiting_time":
      return "Needs Follow Up"
    case "salvage_pending":
      return "Price Denied"
    default:
      return pipelineStatusLabel(status)
  }
}

/** Tailwind badge classes for pipeline-specific overview chips. */
export const PIPELINE_STATUS_BADGE_STYLE: Record<JobPipelineStatusId, string> = {
  unassigned_pool: "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
  DISPATCHED: "bg-teal-500/20 text-teal-100 ring-1 ring-teal-500/30",
  awaiting_time: "bg-violet-500/20 text-violet-100 ring-1 ring-violet-500/30",
  salvage_pending: "bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/30",
}

/** Swimlane / grid card accent when dispatch_status is a pipeline-specific value. */
export function schedulerDispatchCardStyle(dispatch_status?: string | null): string | null {
  const dispatch = (dispatch_status ?? "").trim().toLowerCase()
  if (dispatch === "awaiting_time") {
    return "border-l-4 border-l-violet-500 text-violet-100"
  }
  if (dispatch === "salvage_pending") {
    return "border-l-4 border-l-rose-500 text-rose-100"
  }
  return null
}

/** Convert a scheduler event into a hopper pool job for drawer + pool cache updates. */
export function schedulerEventToPoolJob(event: SchedulerEvent): UnassignedPoolJob {
  const location = (event.location ?? "").trim() || null
  return {
    id: event.id,
    customer_name: event.customer_name,
    customer_phone: event.customer_phone,
    location,
    neighborhood: neighborhoodFromLocation(location),
    summary: event.summary,
    job_type: event.job_type,
    vehicle_year: event.vehicle_year,
    vehicle_make: event.vehicle_make,
    vehicle_model: event.vehicle_model,
    vehicle_vin: event.vehicle_vin,
    programming_method: event.programming_method,
    job_notes: event.job_notes,
    scheduled_at: event.scheduled_tentative ? null : event.scheduled_at,
    duration_minutes: event.duration_minutes,
    dispatch_status: event.dispatch_status,
    created_at: event.created_at,
    latitude: event.latitude,
    longitude: event.longitude,
    quoted_price_cents: event.quoted_price_cents,
    service_quote_type_id: event.service_quote_type_id,
    key_fcc_id: event.key_fcc_id,
    key_frequency: event.key_frequency,
    key_chipset: event.key_chipset,
    key_style: event.key_style,
    key_variant_id: event.key_variant_id,
    key_profile_id: event.key_profile_id,
    discount_applied: event.discount_applied,
    baseline_quoted_price_cents: event.baseline_quoted_price_cents,
    field_verification_required: event.field_verification_required,
  }
}
