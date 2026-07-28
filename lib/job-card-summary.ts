/**
 * Shared job-card facts for owner Active Job and the field tech console.
 * One view-model so both glasses show the same customer / vehicle / address / balance spine.
 */

import { billingBalanceDollarsFromJob } from "@/lib/job-billing-balance"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { googleMapsSearchUrl } from "@/lib/google-maps-search-url"
import {
  formatScheduledDateDisplay,
  formatScheduledTimeDisplay,
} from "@/lib/scheduler-utils"
import {
  OPERATOR_JOB_PHASE_BADGE_STYLE,
  OPERATOR_JOB_PHASE_LABEL,
  resolveOperatorJobPhase,
  type OperatorJobPhase,
} from "@/lib/scheduler-job-status"

/** Minimal job shape both DispatchJob and SchedulerEvent / pool jobs can satisfy. */
export type JobCardSummarySource = {
  customer_name?: string | null
  customer_phone?: string | null
  location?: string | null
  summary?: string | null
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
  scheduled_at?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  job_type?: string | null
  service_quote_type_id?: string | null
  key_frequency?: string | null
  key_style?: string | null
  key_chipset?: string | null
  key_fcc_id?: string | null
  fcc_id?: string | null
  ti_sku?: string | null
  programming_method?: string | null
  quoted_price_cents?: number | null
  billing_balance_cents?: number | null
  field_verification_required?: boolean | null
  job_notes?: string | null
}

/** Normalized facts rendered by JobCardSummary on owner + tech. */
export type JobCardSummaryModel = {
  customerName: string
  customerPhone: string
  phoneHref: string | null
  serviceAddress: string
  mapsUrl: string | null
  vehicleSummary: string
  keyHint: string
  billingBalanceDollars: number
  billingLabel: string
  appointmentLabel: string
  statusPhase: OperatorJobPhase
  statusLabel: string
  statusBadgeClass: string
  fieldVerificationRequired: boolean
  notesPreview: string | null
  summaryLine: string | null
}

/** Build a tel: link when the phone has enough digits. */
export function jobCardTelHref(phone: string): string | null {
  const trimmed = phone.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 10) return null
  if (trimmed.startsWith("+")) return `tel:${trimmed}`
  return `tel:+1${digits.slice(-10)}`
}

/**
 * Turn any job-like row into the shared card model.
 * Optional `billingBalanceDollars` overrides persisted cents (owner drawer already resolved it).
 */
export function buildJobCardSummary(
  source: JobCardSummarySource,
  opts?: { billingBalanceDollars?: number }
): JobCardSummaryModel {
  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const serviceAddress = (source.location ?? "").trim()
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const vehicleBlock = specBlocks.find((block) => block.label === "Vehicle")
  const serviceBlock = specBlocks.find((block) => block.label === "Service")
  const keyBlocks = specBlocks.filter(
    (block) =>
      block.label === "Key" ||
      block.label === "TI SKU" ||
      block.label === "FCC ID" ||
      block.label === "Chip" ||
      block.label === "Programming"
  )
  const vehicleSummary = [vehicleBlock?.value, serviceBlock?.value]
    .filter(Boolean)
    .join(" — ")
  const keyHint =
    keyBlocks.length > 0
      ? keyBlocks
          .map((b) => b.value)
          .filter(Boolean)
          .slice(0, 2)
          .join(" · ")
      : "None on file"

  const billingBalanceDollars =
    opts?.billingBalanceDollars != null
      ? opts.billingBalanceDollars
      : billingBalanceDollarsFromJob(source)
  const billingLabel =
    billingBalanceDollars > 0 ? `$${billingBalanceDollars}` : "No balance"

  const scheduledAtIso = (source.scheduled_at ?? "").trim() || null
  const appointmentLabel = scheduledAtIso
    ? [
        formatScheduledDateDisplay(scheduledAtIso),
        formatScheduledTimeDisplay(scheduledAtIso),
      ]
        .filter(Boolean)
        .join(" · ")
    : "No appointment time"

  const statusPhase = resolveOperatorJobPhase({
    job_status: source.job_status ?? null,
    dispatch_status: source.dispatch_status ?? null,
    assigned_tech_id: source.assigned_tech_id ?? null,
    scheduled_at: scheduledAtIso,
  })

  const notesRaw = (source.job_notes ?? "").trim()
  const summaryRaw = (source.summary ?? "").trim()

  return {
    customerName,
    customerPhone,
    phoneHref: jobCardTelHref(customerPhone),
    serviceAddress,
    mapsUrl: serviceAddress ? googleMapsSearchUrl(serviceAddress) : null,
    vehicleSummary,
    keyHint,
    billingBalanceDollars,
    billingLabel,
    appointmentLabel,
    statusPhase,
    statusLabel: OPERATOR_JOB_PHASE_LABEL[statusPhase],
    statusBadgeClass: OPERATOR_JOB_PHASE_BADGE_STYLE[statusPhase],
    fieldVerificationRequired: Boolean(source.field_verification_required),
    notesPreview: notesRaw ? notesRaw.replace(/\s+/g, " ") : null,
    summaryLine: summaryRaw || null,
  }
}
