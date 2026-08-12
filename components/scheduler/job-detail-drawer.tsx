"use client"

// Right slide-over for reviewing and editing scheduler jobs (overview vs stepped edit workflow).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { ToastAction } from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  JobDetailOverview,
  type JobLifecycleQuickStatus,
} from "@/components/scheduler/job-detail-overview"
import { JobEditWorkflow } from "@/components/scheduler/job-edit-workflow"
import {
  SchedulerJobSlideSheet,
  SchedulerJobSheetCloseButton,
} from "@/components/scheduler/scheduler-job-slide-sheet"
import {
  operatorJobPhaseLabel,
  SCHEDULER_STATUS_LABEL,
  schedulerJobStatusDisplayLabel,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import {
  combineScheduledDateTimeLocal,
  scheduledDateInputFromIso,
  scheduledTimeInputFromIso,
} from "@/lib/scheduler-utils"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import { keyStyleRequiresFieldVerification } from "@/lib/vehicle-trim-features"
import {
  pipelineStatusFromJob,
  pipelineStatusPatch,
  type JobPipelineStatusId,
} from "@/lib/job-pipeline-status"
import {
  dispatchJobTypeFromServiceQuoteTypeId,
  serviceQuoteTypeFromJobType,
} from "@/lib/job-intake-fields"
import {
  billingBalanceDollarsFromJob,
  resolveJobBillingBalanceCents,
} from "@/lib/job-billing-balance"
import { type ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import type {
  ActivePipelineJob,
  DispatchJob,
  FieldTechnician,
  SchedulerEvent,
  UnassignedPoolJob,
} from "@/lib/types"

/** Collect modal needs a DispatchJob shape + quoted_price_cents for invoice prefill. */
type CollectDispatchJob = DispatchJob & { quoted_price_cents?: number | null }

const TechPaymentModal = dynamic(
  () =>
    import("@/components/tech/tech-payment-modal").then((m) => ({
      default: m.TechPaymentModal,
    })),
  { ssr: false }
)

/** Map Active Job / pool row into the Collect Payment job card. */
function toCollectDispatchJob(
  source: UnassignedPoolJob | SchedulerEvent
): CollectDispatchJob {
  const assignedTechId =
    "assigned_tech_id" in source ? source.assigned_tech_id ?? null : null
  const assignedTechName =
    "assigned_tech_name" in source ? source.assigned_tech_name ?? null : null
  const jobStatus = "job_status" in source ? source.job_status ?? null : null
  return {
    id: source.id,
    customer_name: source.customer_name,
    customer_phone: source.customer_phone,
    location: source.location,
    summary: source.summary ?? null,
    job_status: jobStatus,
    assigned_tech_id: assignedTechId,
    assigned_tech_name: assignedTechName,
    latitude: source.latitude ?? null,
    longitude: source.longitude ?? null,
    created_at: source.created_at,
    vehicle_year: source.vehicle_year ?? null,
    vehicle_make: source.vehicle_make ?? null,
    vehicle_model: source.vehicle_model ?? null,
    field_verification_required: source.field_verification_required ?? null,
    // Prefill Collect / pay-link amount from the booked balance.
    quoted_price_cents:
      source.quoted_price_cents ?? source.billing_balance_cents ?? null,
  }
}

type JobDetailViewMode = "overview" | "edit"

type JobDetailDrawerProps = {
  open: boolean
  poolJob: UnassignedPoolJob | null
  scheduledEvent: SchedulerEvent | null
  technicians: FieldTechnician[]
  activePipelineJobs?: ActivePipelineJob[]
  onClose: () => void
  onSaved?: (event: SchedulerEvent) => void
  onStatusChanged?: (event: SchedulerEvent) => void
  onDeleted?: (jobId: string) => void
  /** Intake dispatch flow — focus start time and auto-save when a time is picked. */
  scheduleIntent?: boolean
  onScheduleCommitted?: (event: SchedulerEvent) => void
  /** Increment to switch the drawer into edit mode (command palette /status). */
  editIntentTick?: number
}

export function JobDetailDrawer({
  open,
  poolJob,
  scheduledEvent,
  technicians,
  activePipelineJobs = [],
  onClose,
  onSaved,
  onStatusChanged,
  onDeleted,
  scheduleIntent = false,
  onScheduleCommitted,
  editIntentTick = 0,
}: JobDetailDrawerProps) {
  const listSource = scheduledEvent ?? poolJob
  const jobId = listSource?.id ?? ""
  const onDeletedRef = useRef(onDeleted)
  onDeletedRef.current = onDeleted

  /** Fresh Neon row for Active Job — wins over stale SWR pool/bootstrap cache. */
  const [hydratedEvent, setHydratedEvent] = useState<SchedulerEvent | null>(null)
  const [hydrating, setHydrating] = useState(false)

  const source = hydratedEvent ?? listSource
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [serviceQuoteTypeId, setServiceQuoteTypeId] = useState<ServiceQuoteTypeId>("lockout")
  const [vehicleYear, setVehicleYear] = useState("")
  const [vehicleMake, setVehicleMake] = useState("")
  const [vehicleModel, setVehicleModel] = useState("")
  const [vehicleVin, setVehicleVin] = useState("")
  const [keyFccId, setKeyFccId] = useState("")
  const [keyFrequency, setKeyFrequency] = useState("")
  const [keyChipset, setKeyChipset] = useState("")
  const [keyStyle, setKeyStyle] = useState("")
  const [keyVariantId, setKeyVariantId] = useState("")
  const [keyProfileId, setKeyProfileId] = useState("")
  const [programmingMethod, setProgrammingMethod] = useState("")
  const [editablePrice, setEditablePrice] = useState("")
  const [negotiationDiscountApplied, setNegotiationDiscountApplied] =
    useState<NegotiationDiscountId | null>(null)
  const [location, setLocation] = useState("")
  const [jobNotes, setJobNotes] = useState("")
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [pipelineStatus, setPipelineStatus] = useState<JobPipelineStatusId>("unassigned_pool")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  /** Complete confirm — optional immediate Thanks + review SMS. */
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false)
  /** Cancel confirm — More Actions Cancel used to fire with no dialog (felt like a no-op). */
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Last Thanks+review send failed — overview shows Retry. */
  const [reviewSmsFailed, setReviewSmsFailed] = useState(false)
  const [localJobStatus, setLocalJobStatus] = useState<string | null>(null)
  const { toast } = useToast()
  const [viewMode, setViewMode] = useState<JobDetailViewMode>("overview")
  const [committedPipelineStatus, setCommittedPipelineStatus] =
    useState<JobPipelineStatusId>("unassigned_pool")
  const [committedAssignedTechId, setCommittedAssignedTechId] = useState("")
  const openedAtRef = useRef(0)
  const dispatcherLocation = useDispatcherLocation(open && Boolean(jobId))

  const jobLat = source?.latitude ?? null
  const jobLng = source?.longitude ?? null
  const travelDistanceMilesValue = useMemo(() => {
    if (jobLat == null || jobLng == null) return null
    if (dispatcherLocation.lat == null || dispatcherLocation.lng == null) return null
    return travelDistanceMiles(
      { lat: dispatcherLocation.lat, lng: dispatcherLocation.lng },
      { lat: jobLat, lng: jobLng }
    )
  }, [jobLat, jobLng, dispatcherLocation.lat, dispatcherLocation.lng])

  // Overview billing: persisted API amount only (never client calculator).
  const billingBalanceDollars = billingBalanceDollarsFromJob(source)
  // Money rail → Collect (card / tap / pay link / receipt) for this job.
  const [collectJob, setCollectJob] = useState<CollectDispatchJob | null>(null)

  const resolveQuotedPriceCents = useCallback(() => {
    // Edit mode may change the price field; still fall back to the saved DB quote only.
    return resolveJobBillingBalanceCents({
      editablePriceDollars: editablePrice,
      savedQuotedPriceCents: source?.quoted_price_cents ?? source?.billing_balance_cents,
    })
  }, [editablePrice, source?.quoted_price_cents, source?.billing_balance_cents])

  useEffect(() => {
    if (!open || !jobId) {
      setHydratedEvent(null)
      setHydrating(false)
      return
    }
    let cancelled = false
    setHydrating(true)
    void fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null
        const json = (await res.json().catch(() => ({}))) as {
          data?: { event?: SchedulerEvent }
        }
        return json.data?.event ?? null
      })
      .then((event) => {
        if (cancelled || !event) return
        setHydratedEvent(event)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrating(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, jobId])

  // Optional statusOverride avoids stale React state when auto-saving Price denied.
  const buildSaveBody = useCallback(
    (options?: {
      statusOverride?: JobPipelineStatusId
      assignedTechOverride?: string
    }): Record<string, unknown> => {
    const statusForPatch = options?.statusOverride ?? pipelineStatus
    const techForBody =
      options?.assignedTechOverride !== undefined ? options.assignedTechOverride : assignedTechId
    const quotedPriceCents = resolveQuotedPriceCents()
    // Terminal completed is display-only — do not map it through the pool/dispatch patch helper.
    const pipelinePatch =
      statusForPatch === "completed"
        ? { dispatch_status: "completed", is_salvageable: false, disposition: null as string | null }
        : pipelineStatusPatch(statusForPatch)
    const scheduledAtIso = combineScheduledDateTimeLocal(scheduledDate, scheduledTime)
    // Keep the intake baseline snapshot — do not rewrite it from a live vehicle recalc.
    const persistedBaseline =
      source?.baseline_quoted_price_cents != null && source.baseline_quoted_price_cents > 0
        ? Math.round(source.baseline_quoted_price_cents)
        : null
    return {
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      customer_email: customerEmail.trim().toLowerCase() || null,
      job_type: dispatchJobTypeFromServiceQuoteTypeId(serviceQuoteTypeId),
      duration_minutes: durationMinutes,
      vehicle_year: vehicleYear.trim() || null,
      vehicle_make: vehicleMake.trim() || null,
      vehicle_model: vehicleModel.trim() || null,
      vehicle_vin: vehicleVin.trim() || null,
      job_address: location.trim() || null,
      job_notes: jobNotes.trim() || null,
      assigned_tech_id: techForBody.trim() || null,
      dispatch_status: pipelinePatch.dispatch_status,
      is_salvageable: pipelinePatch.is_salvageable,
      // Price denied → PRICE_REJECTED so scheduler BOOKED/PENDING feeds drop the lead.
      ...(pipelinePatch.disposition != null ? { disposition: pipelinePatch.disposition } : {}),
      service_quote_type_id: serviceQuoteTypeId,
      quoted_price_cents: quotedPriceCents > 0 ? quotedPriceCents : null,
      distance_miles: travelDistanceMilesValue,
      key_fcc_id: keyFccId.trim() || null,
      key_frequency: keyFrequency.trim() || null,
      key_chipset: keyChipset.trim() || null,
      key_style: keyStyle.trim() || null,
      key_variant_id: keyVariantId.trim() || null,
      key_profile_id: keyProfileId.trim() || null,
      programming_method: programmingMethod.trim() || null,
      discount_applied: negotiationDiscountApplied,
      baseline_quote_cents: persistedBaseline,
      field_verification_required: keyStyleRequiresFieldVerification(keyStyle),
      ...(scheduledAtIso ? { scheduled_at: scheduledAtIso } : {}),
    }
  },
  [
    assignedTechId,
    customerName,
    customerPhone,
    customerEmail,
    durationMinutes,
    jobNotes,
    keyChipset,
    keyFccId,
    keyFrequency,
    keyProfileId,
    keyStyle,
    keyVariantId,
    programmingMethod,
    location,
    negotiationDiscountApplied,
    source?.baseline_quoted_price_cents,
    pipelineStatus,
    resolveQuotedPriceCents,
    scheduledDate,
    scheduledTime,
    serviceQuoteTypeId,
    travelDistanceMilesValue,
    vehicleMake,
    vehicleModel,
    vehicleVin,
    vehicleYear,
  ])

  const handleServiceTypeChange = useCallback((id: ServiceQuoteTypeId) => {
    setServiceQuoteTypeId(id)
  }, [])

  const poolWithTech = poolJob as (UnassignedPoolJob & {
    job_status?: string | null
    assigned_tech_id?: string | null
  }) | null

  const lifecyclePhase = schedulerLifecyclePhase({
    job_status: localJobStatus ?? scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null,
    dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
    assigned_tech_id: scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? null,
  })
  const rawJobStatus = localJobStatus ?? scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null
  // Prefer single operator glossary over raw job_status / conflicting pills.
  const statusLabel =
    operatorJobPhaseLabel({
      job_status: rawJobStatus,
      dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
      assigned_tech_id: scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? null,
      scheduled_at: scheduledEvent?.scheduled_at ?? poolJob?.scheduled_at ?? null,
    }) ||
    schedulerJobStatusDisplayLabel(rawJobStatus) ||
    SCHEDULER_STATUS_LABEL[lifecyclePhase]

  useEffect(() => {
    if (!source) return
    setLocalJobStatus(scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null)
    setCustomerName(source.customer_name ?? "")
    setCustomerPhone(source.customer_phone ?? "")
    setCustomerEmail(source.customer_email ?? "")
    setServiceQuoteTypeId(
      source.service_quote_type_id
        ? normalizeServiceQuoteTypeId(source.service_quote_type_id)
        : serviceQuoteTypeFromJobType(source.job_type ?? "")
    )
    // Prefer job collected YMM; garage fill runs below when collected is empty.
    setVehicleYear(source.vehicle_year ?? "")
    setVehicleMake(source.vehicle_make ?? "")
    setVehicleModel(source.vehicle_model ?? "")
    setVehicleVin(source.vehicle_vin ?? "")
    setKeyFccId(source.key_fcc_id ?? "")
    setKeyFrequency(source.key_frequency ?? "")
    setKeyChipset(source.key_chipset ?? "")
    setKeyStyle(source.key_style ?? "")
    setKeyVariantId(source.key_variant_id ?? "")
    setKeyProfileId(source.key_profile_id ?? "")
    setProgrammingMethod(source.programming_method ?? "")
    const savedCents = source.quoted_price_cents ?? 0
    setEditablePrice(savedCents > 0 ? String(Math.round(savedCents / 100)) : "")
    setNegotiationDiscountApplied(
      (source.discount_applied as NegotiationDiscountId | null) ?? null
    )
    setLocation(source.location ?? "")
    setJobNotes(source.job_notes ?? "")
    setDurationMinutes(source.duration_minutes ?? 60)
    const scheduledIso =
      scheduledEvent?.scheduled_at ??
      poolJob?.scheduled_at ??
      (scheduledEvent && !scheduledEvent.scheduled_tentative ? scheduledEvent.scheduled_at : null)
    setScheduledDate(scheduledDateInputFromIso(scheduledIso))
    setScheduledTime(scheduledTimeInputFromIso(scheduledIso))
    setAssignedTechId(scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? "")
    const loadedPipeline = pipelineStatusFromJob({
      dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
      assigned_tech_id: scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? null,
      job_status: scheduledEvent?.job_status ?? poolWithTech?.job_status ?? localJobStatus,
    })
    setPipelineStatus(loadedPipeline)
    setCommittedPipelineStatus(loadedPipeline)
    setCommittedAssignedTechId(scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? "")
    setError(null)
  }, [source, scheduledEvent, poolJob, poolWithTech?.assigned_tech_id])

  // Clear review-SMS failure only when switching jobs (not on hydrate after Complete).
  useEffect(() => {
    setReviewSmsFailed(false)
  }, [jobId])

  useEffect(() => {
    if (!open || !jobId) return
    setViewMode(scheduleIntent ? "edit" : "overview")
  }, [open, jobId, scheduleIntent])

  // Garage as vehicle SoT when job collected YMM is blank (Book / returning caller sheet).
  // Also backfill Customer email from CRM notes when the lead has none yet.
  useEffect(() => {
    if (!open || !jobId) return
    const phone = (customerPhone || source?.customer_phone || "").trim()
    if (!phone) return
    const hasYmm =
      Boolean(vehicleYear.trim()) || Boolean(vehicleMake.trim()) || Boolean(vehicleModel.trim())
    const needsEmail = !customerEmail.trim()
    if (hasYmm && !needsEmail) return
    let cancelled = false
    void fetch(`/api/customers?phone=${encodeURIComponent(phone)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customers?: Array<{ id?: string }> } | null) => {
        const customerId = data?.customers?.[0]?.id?.trim()
        if (!customerId || cancelled) return null
        return fetch(`/api/crm/customers/${encodeURIComponent(customerId)}`, {
          credentials: "include",
        })
      })
      .then(async (res) => {
        if (!res || !res.ok || cancelled) return
        const json = (await res.json().catch(() => null)) as {
          data?: {
            customer?: { notes?: string }
            vehicles?: Array<{ year?: string; make?: string; model?: string; vin?: string; fcc_id?: string }>
          }
        } | null
        const garage = json?.data?.vehicles?.[0]
        if (garage && !cancelled && !hasYmm) {
          setVehicleYear((prev) => prev.trim() || String(garage.year ?? "").trim())
          setVehicleMake((prev) => prev.trim() || String(garage.make ?? "").trim())
          setVehicleModel((prev) => prev.trim() || String(garage.model ?? "").trim())
          setVehicleVin((prev) => prev.trim() || String(garage.vin ?? "").trim())
          setKeyFccId((prev) => prev.trim() || String(garage.fcc_id ?? "").trim())
        }
        if (needsEmail && !cancelled) {
          const { emailFromCustomerNotes } = await import("@/lib/crm-walk-up-history")
          const fromNotes = emailFromCustomerNotes(json?.data?.customer?.notes)
          if (fromNotes) setCustomerEmail((prev) => prev.trim() || fromNotes)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [
    open,
    jobId,
    customerPhone,
    customerEmail,
    source?.customer_phone,
    vehicleYear,
    vehicleMake,
    vehicleModel,
  ])

  useEffect(() => {
    if (!open) setViewMode("overview")
  }, [open])

  useEffect(() => {
    if (!open || editIntentTick <= 0) return
    setViewMode("edit")
  }, [open, editIntentTick])

  useEffect(() => {
    // Stamp open time once per job open — do not depend on `source` object identity
    // (parent re-renders were resetting this and blocking the X close button).
    if (open && jobId) openedAtRef.current = Date.now()
  }, [open, jobId])

  const pipelineDirty =
    pipelineStatus !== committedPipelineStatus || assignedTechId !== committedAssignedTechId

  // Escape is handled by SchedulerJobSlideSheet.

  const canSave = customerName.trim().length > 0 && customerPhone.trim().length > 0

  const applySavedEvent = useCallback((event: SchedulerEvent) => {
    setHydratedEvent(event)
    setLocalJobStatus(event.job_status ?? null)
    setCustomerName(event.customer_name ?? "")
    setCustomerPhone(event.customer_phone ?? "")
    setCustomerEmail(event.customer_email ?? "")
    setServiceQuoteTypeId(
      event.service_quote_type_id
        ? normalizeServiceQuoteTypeId(event.service_quote_type_id)
        : serviceQuoteTypeFromJobType(event.job_type ?? "")
    )
    setVehicleYear(event.vehicle_year ?? "")
    setVehicleMake(event.vehicle_make ?? "")
    setVehicleModel(event.vehicle_model ?? "")
    setVehicleVin(event.vehicle_vin ?? "")
    setKeyFccId(event.key_fcc_id ?? "")
    setKeyFrequency(event.key_frequency ?? "")
    setKeyChipset(event.key_chipset ?? "")
    setKeyStyle(event.key_style ?? "")
    setKeyVariantId(event.key_variant_id ?? "")
    setKeyProfileId(event.key_profile_id ?? "")
    const savedCents = event.quoted_price_cents ?? 0
    setEditablePrice(savedCents > 0 ? String(Math.round(savedCents / 100)) : "")
    setNegotiationDiscountApplied((event.discount_applied as NegotiationDiscountId | null) ?? null)
    setLocation(event.location ?? "")
    setJobNotes(event.job_notes ?? "")
    setDurationMinutes(event.duration_minutes ?? 60)
    setScheduledDate(scheduledDateInputFromIso(event.scheduled_at))
    setScheduledTime(scheduledTimeInputFromIso(event.scheduled_at))
    setAssignedTechId(event.assigned_tech_id ?? "")
    setPipelineStatus(
      pipelineStatusFromJob({
        dispatch_status: event.dispatch_status,
        assigned_tech_id: event.assigned_tech_id,
        job_status: event.job_status,
      })
    )
    setCommittedPipelineStatus(
      pipelineStatusFromJob({
        dispatch_status: event.dispatch_status,
        assigned_tech_id: event.assigned_tech_id,
        job_status: event.job_status,
      })
    )
    setCommittedAssignedTechId(event.assigned_tech_id ?? "")
  }, [])

  async function handleSave(options?: {
    fromScheduleIntent?: boolean
    statusOverride?: JobPipelineStatusId
    assignedTechOverride?: string
  }): Promise<boolean> {
    if (!jobId) {
      setError("This job could not be found.")
      return false
    }
    if (!canSave) {
      setError("Customer name and phone are required before saving.")
      return false
    }
    setSaving(true)
    setError(null)
    try {
      const body = buildSaveBody({
        statusOverride: options?.statusOverride,
        assignedTechOverride: options?.assignedTechOverride,
      })
      const scheduledAtIso = combineScheduledDateTimeLocal(scheduledDate, scheduledTime)
      if (scheduledAtIso) {
        body.scheduled_at = scheduledAtIso
      }
      const res = await fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not save job")
      const event = json.data?.event
      if (!event) throw new Error("No updated job returned")
      applySavedEvent(event)
      onSaved?.(event)
      onStatusChanged?.(event)
      setViewMode("overview")
      if (options?.fromScheduleIntent) {
        onScheduleCommitted?.(event)
      }
      // Keep garage SoT in sync with job collected YMM (same upsert intake uses).
      const phone = (event.customer_phone || customerPhone).trim()
      const year = (event.vehicle_year || vehicleYear).trim()
      const make = (event.vehicle_make || vehicleMake).trim()
      const model = (event.vehicle_model || vehicleModel).trim()
      if (phone && (year || make || model)) {
        void fetch(`/api/customers?phone=${encodeURIComponent(phone)}`, {
          credentials: "include",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { customers?: Array<{ id?: string }> } | null) => {
            const customerId = data?.customers?.[0]?.id?.trim()
            if (!customerId) return
            return fetch(`/api/crm/customers/${encodeURIComponent(customerId)}/vehicles`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                year,
                make,
                model,
                vin: (event.vehicle_vin || vehicleVin).trim(),
                fcc_id: (event.key_fcc_id || keyFccId).trim(),
              }),
            })
          })
          .catch(() => {
            /* garage optional until migration 120 */
          })
      }
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save job")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!jobId || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not delete job")
      setDeleteConfirmOpen(false)
      onDeletedRef.current?.(jobId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete job")
    } finally {
      setDeleting(false)
    }
  }

  async function handleSavePipeline() {
    if (!pipelineDirty) return
    if (pipelineStatus === "DISPATCHED" && !assignedTechId.trim()) {
      setError("Select a technician to mark this job as scheduled.")
      return
    }
    const ok = await handleSave()
    if (ok) {
      setCommittedPipelineStatus(pipelineStatus)
      setCommittedAssignedTechId(assignedTechId)
    }
  }

  // Persist Internal Dispatch Notes without forcing a pipeline change.
  async function handleSaveJobNotes() {
    if (!jobId || saving) return
    if (!canSave) return
    const committedNotes = (scheduledEvent?.job_notes ?? poolJob?.job_notes ?? "").trim()
    if (jobNotes.trim() === committedNotes) return
    await handleSave()
  }

  // Cancel / Referred / Complete — write job_status then close the drawer.
  // Cancel + Complete open confirms first so a busy save cannot swallow the tap.
  async function handleQuickLifecycleAction(
    status: JobLifecycleQuickStatus,
    options?: { sendReviewSms?: boolean; confirmed?: boolean }
  ) {
    // Need a job id before any confirm or PATCH.
    if (!jobId) return
    // Open confirms even while saving — otherwise notes blur → setSaving(true) made Cancel a silent no-op.
    if (status === "cancelled" && !options?.confirmed) {
      setCancelConfirmOpen(true)
      return
    }
    // Complete needs a confirm (review SMS choice); other actions run immediately.
    if (status === "completed" && options?.sendReviewSms === undefined) {
      setCompleteConfirmOpen(true)
      return
    }
    // Block double-submits once the operator confirmed.
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      // Keep any pending notes so close-out context is not lost.
      const committedNotes = (scheduledEvent?.job_notes ?? poolJob?.job_notes ?? "").trim()
      if (canSave && jobNotes.trim() !== committedNotes) {
        const body = buildSaveBody()
        const notesRes = await fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const notesJson = (await notesRes.json()) as {
          error?: string
          data?: { event?: SchedulerEvent }
        }
        if (!notesRes.ok) throw new Error(notesJson.error ?? "Could not save notes")
        if (notesJson.data?.event) applySavedEvent(notesJson.data.event)
      }

      const res = await fetch(`/api/owner/jobs/${encodeURIComponent(jobId)}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          // Waiting Pool / offline jobs can complete without scheduling a tech.
          ...(status === "completed" && options?.sendReviewSms
            ? { send_review_sms: true }
            : {}),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          event?: SchedulerEvent
          review_sms?: { sent: boolean; error: string | null } | null
        }
      }
      if (!res.ok) throw new Error(json.error ?? "Could not update job status")
      const event = json.data?.event
      if (event) {
        applySavedEvent(event)
        onStatusChanged?.(event)
        onSaved?.(event)
      }
      setCompleteConfirmOpen(false)
      setCancelConfirmOpen(false)
      // Complete succeeded — surface review SMS failure without losing the close-out.
      const reviewSms = json.data?.review_sms
      if (options?.sendReviewSms && reviewSms && !reviewSms.sent) {
        setReviewSmsFailed(true)
        const msg = reviewSms.error || "Could not send review SMS"
        setError(msg)
        toast({
          title: "Job completed — review SMS failed",
          description: msg,
          variant: "destructive",
          action: (
            <ToastAction altText="Retry review SMS" onClick={() => void handleSendReviewSms()}>
              Retry
            </ToastAction>
          ),
        })
        return
      }
      if (options?.sendReviewSms) {
        setReviewSmsFailed(false)
        toast({ title: "Completed + review SMS sent" })
      } else if (status === "cancelled") {
        // Confirm the close-out so Cancel never feels like a dead tap.
        toast({ title: "Job cancelled" })
      } else if (status === "referred") {
        toast({ title: "Marked referred" })
      }
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update job status"
      setError(msg)
      // Toast so the failure is visible even when the error line is scrolled off-screen.
      toast({
        title: status === "cancelled" ? "Could not cancel job" : "Could not update job",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  /** Already-complete jobs: send Thanks + review via the existing owner endpoint. */
  async function handleSendReviewSms() {
    if (!jobId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/owner/jobs/${encodeURIComponent(jobId)}/thanks-review`, {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not send review SMS")
      setReviewSmsFailed(false)
      toast({ title: "Thanks + review sent" })
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send review SMS"
      setReviewSmsFailed(true)
      setError(msg)
      toast({
        title: "Could not send review SMS",
        description: msg,
        variant: "destructive",
        action: (
          <ToastAction altText="Retry review SMS" onClick={() => void handleSendReviewSms()}>
            Retry
          </ToastAction>
        ),
      })
    } finally {
      setSaving(false)
    }
  }

  const requestClose = useCallback(() => {
    onClose()
  }, [onClose])

  /** Backdrop only — ignore the accidental tap that opens the sheet. */
  const requestCloseFromScrim = useCallback(() => {
    if (Date.now() - openedAtRef.current < 400) return
    onClose()
  }, [onClose])

  return (
    <>
      <SchedulerJobSlideSheet open={open && Boolean(source)} onClose={requestCloseFromScrim}>
        <SchedulerJobSheetCloseButton onClose={requestClose} />
        {source ? (
          viewMode === "overview" ? (
            <JobDetailOverview
              source={source}
              scheduledEvent={scheduledEvent}
              poolJob={poolJob}
              technicians={technicians}
              activePipelineJobs={activePipelineJobs}
              billingBalanceDollars={billingBalanceDollars}
              jobNotes={jobNotes}
              pipelineStatus={pipelineStatus}
              assignedTechId={assignedTechId}
              pipelineDirty={pipelineDirty}
              saving={saving}
              hydrating={hydrating}
              error={error}
              onEdit={() => setViewMode("edit")}
              onPipelineStatusChange={(status) => {
                setPipelineStatus(status)
                if (status !== "DISPATCHED") setAssignedTechId("")
                // Price denied must persist immediately so Coming Up Next drops the lead.
                if (status === "salvage_pending") {
                  void (async () => {
                    const ok = await handleSave({
                      statusOverride: "salvage_pending",
                      assignedTechOverride: "",
                    })
                    if (ok) {
                      setCommittedPipelineStatus("salvage_pending")
                      setCommittedAssignedTechId("")
                    }
                  })()
                }
              }}
              onAssignedTechChange={(techId) => {
                setAssignedTechId(techId)
                if (techId.trim()) setPipelineStatus("DISPATCHED")
              }}
              onSavePipeline={() => void handleSavePipeline()}
              onJobNotesChange={setJobNotes}
              onSaveJobNotes={() => void handleSaveJobNotes()}
              onQuickLifecycleAction={(status) => void handleQuickLifecycleAction(status)}
              onSendReviewSms={() => void handleSendReviewSms()}
              reviewSmsFailed={reviewSmsFailed}
              onCollectPayment={() => setCollectJob(toCollectDispatchJob(source))}
            />
          ) : (
            <JobEditWorkflow
              key={`${jobId}-edit`}
              statusLabel={statusLabel}
              lifecyclePhase={lifecyclePhase}
              customerName={customerName}
              customerPhone={customerPhone}
              customerEmail={customerEmail}
              location={location}
              jobNotes={jobNotes}
              serviceQuoteTypeId={serviceQuoteTypeId}
              scheduledDate={scheduledDate}
              scheduledTime={scheduledTime}
              vehicleYear={vehicleYear}
              vehicleMake={vehicleMake}
              vehicleModel={vehicleModel}
              vehicleVin={vehicleVin}
              editablePrice={editablePrice}
              saving={saving}
              deleting={deleting}
              canSave={canSave}
              error={error}
              onBackToOverview={() => setViewMode("overview")}
              onCustomerNameChange={setCustomerName}
              onCustomerPhoneChange={setCustomerPhone}
              onCustomerEmailChange={setCustomerEmail}
              onLocationChange={setLocation}
              onJobNotesChange={setJobNotes}
              onServiceTypeChange={handleServiceTypeChange}
              onScheduledDateChange={setScheduledDate}
              onScheduledTimeChange={setScheduledTime}
              onVehicleYearChange={setVehicleYear}
              onVehicleMakeChange={setVehicleMake}
              onVehicleModelChange={setVehicleModel}
              onVehicleVinChange={setVehicleVin}
              onEditablePriceChange={setEditablePrice}
              onSave={() => handleSave()}
              onSaveSuccess={() => setViewMode("overview")}
              onDeleteRequest={() => setDeleteConfirmOpen(true)}
            />
          )
        ) : null}
      </SchedulerJobSlideSheet>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the job from your scheduler and hopper. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={completeConfirmOpen}
        onOpenChange={(open) => {
          if (saving) return
          setCompleteConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark job complete?</AlertDialogTitle>
            <AlertDialogDescription>
              Send a thank-you + review text, or complete only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
              disabled={saving}
              onClick={(e) => {
                e.preventDefault()
                void handleQuickLifecycleAction("completed", { sendReviewSms: true })
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete & send review text"}
            </AlertDialogAction>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void handleQuickLifecycleAction("completed", { sendReviewSms: false })}
            >
              Complete only
            </Button>
            <AlertDialogCancel disabled={saving}>Keep job open</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* More Actions → Cancel: confirm before writing cancelled status. */}
      <AlertDialog
        open={cancelConfirmOpen}
        onOpenChange={(open) => {
          if (saving) return
          setCancelConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the job cancelled and removes it from the In pool / active lists.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
              onClick={(e) => {
                e.preventDefault()
                void handleQuickLifecycleAction("cancelled", { confirmed: true })
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Money-on-the-job Collect — same modal techs use (pay link → tip → receipt). */}
      {collectJob ? (
        <TechPaymentModal
          job={collectJob}
          onClose={() => setCollectJob(null)}
          onCompleted={() => {
            setCollectJob(null)
            toast({
              title: "Payment recorded",
              description: "Send a receipt from Collect if you have not already.",
            })
            // Refresh Active Job so paid pay-link badges can catch up.
            if (jobId) {
              void fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
                credentials: "include",
                cache: "no-store",
              })
                .then(async (res) => {
                  if (!res.ok) return
                  const json = (await res.json()) as { data?: SchedulerEvent }
                  if (json.data) setHydratedEvent(json.data)
                })
                .catch(() => {})
            }
          }}
        />
      ) : null}
    </>
  )
}
