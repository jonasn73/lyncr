"use client"

// Right slide-over for reviewing and editing scheduler jobs (overview vs stepped edit workflow).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
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
import { JobDetailOverview } from "@/components/scheduler/job-detail-overview"
import { JobEditWorkflow } from "@/components/scheduler/job-edit-workflow"
import {
  SchedulerJobSlideSheet,
  SchedulerJobSheetCloseButton,
} from "@/components/scheduler/scheduler-job-slide-sheet"
import {
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { toDatetimeLocalValue } from "@/lib/scheduler-utils"
import { shouldAutoAdvanceAfterSchedulePick } from "@/lib/scheduler-focus-url"
import { negotiationDiscountLabel } from "@/lib/price-negotiation"
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
import { calculateServiceQuote, type ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"
import type { ServiceRateCard } from "@/lib/service-rate-card"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type JobDetailViewMode = "overview" | "edit"

type JobDetailDrawerProps = {
  open: boolean
  poolJob: UnassignedPoolJob | null
  scheduledEvent: SchedulerEvent | null
  technicians: FieldTechnician[]
  onClose: () => void
  onSaved?: (event: SchedulerEvent) => void
  onStatusChanged?: (event: SchedulerEvent) => void
  onDeleted?: (jobId: string) => void
  /** Intake dispatch flow — focus start time and auto-save when a time is picked. */
  scheduleIntent?: boolean
  onScheduleCommitted?: (event: SchedulerEvent) => void
}

function startLocalFromIso(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return toDatetimeLocalValue(d)
}

export function JobDetailDrawer({
  open,
  poolJob,
  scheduledEvent,
  technicians,
  onClose,
  onSaved,
  onStatusChanged,
  onDeleted,
  scheduleIntent = false,
  onScheduleCommitted,
}: JobDetailDrawerProps) {
  const source = scheduledEvent ?? poolJob
  const jobId = source?.id ?? ""
  const onDeletedRef = useRef(onDeleted)
  onDeletedRef.current = onDeleted

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [serviceQuoteTypeId, setServiceQuoteTypeId] = useState<ServiceQuoteTypeId>("lockout")
  const [vehicleYear, setVehicleYear] = useState("")
  const [vehicleMake, setVehicleMake] = useState("")
  const [vehicleModel, setVehicleModel] = useState("")
  const [keyFccId, setKeyFccId] = useState("")
  const [keyFrequency, setKeyFrequency] = useState("")
  const [keyChipset, setKeyChipset] = useState("")
  const [keyStyle, setKeyStyle] = useState("")
  const [keyVariantId, setKeyVariantId] = useState("")
  const [keyProfileId, setKeyProfileId] = useState("")
  const [editablePrice, setEditablePrice] = useState("")
  const [priceOverridden, setPriceOverridden] = useState(false)
  const [negotiationDiscountApplied, setNegotiationDiscountApplied] =
    useState<NegotiationDiscountId | null>(null)
  const [rateCard, setRateCard] = useState<ServiceRateCard | null>(null)
  const [rateCardSource, setRateCardSource] = useState<"onboarding_profiles.service_rules" | "default">("default")
  const [location, setLocation] = useState("")
  const [jobNotes, setJobNotes] = useState("")
  const [startLocal, setStartLocal] = useState("")
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [pipelineStatus, setPipelineStatus] = useState<JobPipelineStatusId>("unassigned_pool")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localJobStatus, setLocalJobStatus] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<JobDetailViewMode>("overview")
  const userPickedScheduleRef = useRef(false)
  const lastAutoSavedLocalRef = useRef<string | null>(null)
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

  const liveQuote = useMemo(
    () =>
      calculateServiceQuote({
        serviceTypeId: serviceQuoteTypeId,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        rateCard,
        rateCardSource,
        distanceMiles: travelDistanceMilesValue,
        keyStyle,
        keyChipset,
        keyVariantId,
      }),
    [
      serviceQuoteTypeId,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      rateCard,
      rateCardSource,
      travelDistanceMilesValue,
      keyStyle,
      keyChipset,
      keyVariantId,
    ]
  )

  const autoTotalDollars =
    liveQuote.totalCents > 0 ? Math.round(liveQuote.totalCents / 100) : 0

  const resolveQuotedPriceCents = useCallback(() => {
    const raw = editablePrice.trim()
    if (!raw) return liveQuote.totalCents
    const dollars = Number.parseFloat(raw)
    if (Number.isFinite(dollars) && dollars >= 0) return Math.round(dollars * 100)
    return liveQuote.totalCents
  }, [editablePrice, liveQuote.totalCents])

  const buildSaveBody = useCallback((): Record<string, unknown> => {
    const quotedPriceCents = resolveQuotedPriceCents()
    const pipelinePatch = pipelineStatusPatch(pipelineStatus)
    return {
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      job_type: dispatchJobTypeFromServiceQuoteTypeId(serviceQuoteTypeId),
      duration_minutes: durationMinutes,
      vehicle_year: vehicleYear.trim() || null,
      vehicle_make: vehicleMake.trim() || null,
      vehicle_model: vehicleModel.trim() || null,
      job_address: location.trim() || null,
      job_notes: jobNotes.trim() || null,
      assigned_tech_id: assignedTechId.trim() || null,
      dispatch_status: pipelinePatch.dispatch_status,
      is_salvageable: pipelinePatch.is_salvageable,
      service_quote_type_id: serviceQuoteTypeId,
      quoted_price_cents: quotedPriceCents > 0 ? quotedPriceCents : null,
      distance_miles: travelDistanceMilesValue,
      key_fcc_id: keyFccId.trim() || null,
      key_frequency: keyFrequency.trim() || null,
      key_chipset: keyChipset.trim() || null,
      key_style: keyStyle.trim() || null,
      key_variant_id: keyVariantId.trim() || null,
      key_profile_id: keyProfileId.trim() || null,
      discount_applied: negotiationDiscountApplied,
      baseline_quote_cents: liveQuote.totalCents > 0 ? liveQuote.totalCents : null,
      field_verification_required: keyStyleRequiresFieldVerification(keyStyle),
    }
  }, [
    assignedTechId,
    customerName,
    customerPhone,
    durationMinutes,
    jobNotes,
    keyChipset,
    keyFccId,
    keyFrequency,
    keyProfileId,
    keyStyle,
    keyVariantId,
    location,
    negotiationDiscountApplied,
    liveQuote.totalCents,
    pipelineStatus,
    resolveQuotedPriceCents,
    serviceQuoteTypeId,
    travelDistanceMilesValue,
    vehicleMake,
    vehicleModel,
    vehicleYear,
  ])

  const handleServiceTypeChange = useCallback((id: ServiceQuoteTypeId) => {
    setServiceQuoteTypeId(id)
    setPriceOverridden(false)
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
  const statusLabel = SCHEDULER_STATUS_LABEL[lifecyclePhase]

  useEffect(() => {
    if (!source) return
    setLocalJobStatus(scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null)
    setCustomerName(source.customer_name ?? "")
    setCustomerPhone(source.customer_phone ?? "")
    setServiceQuoteTypeId(
      source.service_quote_type_id
        ? normalizeServiceQuoteTypeId(source.service_quote_type_id)
        : serviceQuoteTypeFromJobType(source.job_type ?? "")
    )
    setVehicleYear(source.vehicle_year ?? "")
    setVehicleMake(source.vehicle_make ?? "")
    setVehicleModel(source.vehicle_model ?? "")
    setKeyFccId(source.key_fcc_id ?? "")
    setKeyFrequency(source.key_frequency ?? "")
    setKeyChipset(source.key_chipset ?? "")
    setKeyStyle(source.key_style ?? "")
    setKeyVariantId(source.key_variant_id ?? "")
    setKeyProfileId(source.key_profile_id ?? "")
    const savedCents = source.quoted_price_cents ?? 0
    setEditablePrice(savedCents > 0 ? String(Math.round(savedCents / 100)) : "")
    setPriceOverridden(savedCents > 0)
    setNegotiationDiscountApplied(
      (source.discount_applied as NegotiationDiscountId | null) ?? null
    )
    setLocation(source.location ?? "")
    setJobNotes(source.job_notes ?? "")
    setDurationMinutes(source.duration_minutes ?? 60)
    setStartLocal(
      startLocalFromIso(
        scheduledEvent?.scheduled_at ??
          poolJob?.scheduled_at ??
          (scheduledEvent && !scheduledEvent.scheduled_tentative ? scheduledEvent.scheduled_at : null)
      )
    )
    setAssignedTechId(scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? "")
    setPipelineStatus(
      pipelineStatusFromJob({
        dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
        assigned_tech_id: scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? null,
      })
    )
    setError(null)
    userPickedScheduleRef.current = false
    lastAutoSavedLocalRef.current = null
  }, [source, scheduledEvent, poolJob, poolWithTech?.assigned_tech_id])

  useEffect(() => {
    if (!open || !jobId) return
    setViewMode(scheduleIntent ? "edit" : "overview")
  }, [open, jobId, scheduleIntent])

  useEffect(() => {
    if (!open) setViewMode("overview")
  }, [open])

  useEffect(() => {
    if (!open || !jobId) return
    let cancel = false
    void fetch("/api/service-quote/rate-card", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((data: { data?: { rate_card?: ServiceRateCard; source?: string } }) => {
        if (cancel) return
        if (data.data?.rate_card) {
          setRateCard(data.data.rate_card)
          setRateCardSource(
            data.data.source === "onboarding_profiles.service_rules"
              ? "onboarding_profiles.service_rules"
              : "default"
          )
        }
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [open, jobId])

  useEffect(() => {
    if (!source || priceOverridden) return
    setEditablePrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
  }, [source, autoTotalDollars, priceOverridden, serviceQuoteTypeId, vehicleYear, vehicleMake, vehicleModel, keyStyle, keyChipset, keyVariantId])

  useEffect(() => {
    if (!scheduleIntent || !open || !userPickedScheduleRef.current) return
    if (!shouldAutoAdvanceAfterSchedulePick(startLocal)) return
    if (lastAutoSavedLocalRef.current === startLocal.trim()) return
    if (!jobId || customerName.trim().length === 0 || customerPhone.trim().length === 0) return

    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true)
        setError(null)
        try {
          const body = buildSaveBody()
          body.scheduled_at = new Date(startLocal).toISOString()
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
          lastAutoSavedLocalRef.current = startLocal.trim()
          onSaved?.(event)
          onScheduleCommitted?.(event)
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save job")
        } finally {
          setSaving(false)
        }
      })()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [
    startLocal,
    scheduleIntent,
    open,
    jobId,
    customerName,
    customerPhone,
    buildSaveBody,
    onSaved,
    onScheduleCommitted,
  ])

  const openedAtRef = useRef(0)

  useEffect(() => {
    if (open && source) openedAtRef.current = Date.now()
  }, [open, source])

  // Escape is handled by SchedulerJobSlideSheet.

  const canSave = customerName.trim().length > 0 && customerPhone.trim().length > 0

  const applySavedEvent = useCallback((event: SchedulerEvent) => {
    setLocalJobStatus(event.job_status ?? null)
    setCustomerName(event.customer_name ?? "")
    setCustomerPhone(event.customer_phone ?? "")
    setServiceQuoteTypeId(
      event.service_quote_type_id
        ? normalizeServiceQuoteTypeId(event.service_quote_type_id)
        : serviceQuoteTypeFromJobType(event.job_type ?? "")
    )
    setVehicleYear(event.vehicle_year ?? "")
    setVehicleMake(event.vehicle_make ?? "")
    setVehicleModel(event.vehicle_model ?? "")
    setKeyFccId(event.key_fcc_id ?? "")
    setKeyFrequency(event.key_frequency ?? "")
    setKeyChipset(event.key_chipset ?? "")
    setKeyStyle(event.key_style ?? "")
    setKeyVariantId(event.key_variant_id ?? "")
    setKeyProfileId(event.key_profile_id ?? "")
    const savedCents = event.quoted_price_cents ?? 0
    setEditablePrice(savedCents > 0 ? String(Math.round(savedCents / 100)) : "")
    setPriceOverridden(savedCents > 0)
    setNegotiationDiscountApplied((event.discount_applied as NegotiationDiscountId | null) ?? null)
    setLocation(event.location ?? "")
    setJobNotes(event.job_notes ?? "")
    setDurationMinutes(event.duration_minutes ?? 60)
    setStartLocal(startLocalFromIso(event.scheduled_at))
    setAssignedTechId(event.assigned_tech_id ?? "")
    setPipelineStatus(
      pipelineStatusFromJob({
        dispatch_status: event.dispatch_status,
        assigned_tech_id: event.assigned_tech_id,
      })
    )
  }, [])

  async function handleSave(options?: { fromScheduleIntent?: boolean }): Promise<boolean> {
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
      const body = buildSaveBody()
      if (startLocal.trim()) {
        body.scheduled_at = new Date(startLocal).toISOString()
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
      setViewMode("overview")
      if (options?.fromScheduleIntent) {
        lastAutoSavedLocalRef.current = startLocal.trim()
        onScheduleCommitted?.(event)
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

  async function handlePipelineControlChange(updates: {
    pipelineStatus?: JobPipelineStatusId
    assignedTechId?: string
  }) {
    if (!jobId || !canSave) return

    const nextStatus = updates.pipelineStatus ?? pipelineStatus
    let nextTechId = updates.assignedTechId !== undefined ? updates.assignedTechId : assignedTechId

    if (nextStatus !== "DISPATCHED") {
      nextTechId = ""
    } else if (!nextTechId.trim()) {
      setError("Select a technician to mark this job as scheduled.")
      return
    }

    const previousStatus = pipelineStatus
    const previousTechId = assignedTechId
    setPipelineStatus(nextStatus)
    setAssignedTechId(nextTechId)
    setStatusUpdating(true)
    setError(null)

    try {
      const pipelinePatch = pipelineStatusPatch(nextStatus)
      const body = buildSaveBody()
      body.dispatch_status = pipelinePatch.dispatch_status
      body.is_salvageable = pipelinePatch.is_salvageable
      body.assigned_tech_id = nextTechId.trim() || null
      body.job_notes = jobNotes.trim() || null

      const res = await fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not update job pipeline")
      const event = json.data?.event
      if (!event) throw new Error("No updated job returned")
      applySavedEvent(event)
      onSaved?.(event)
      onStatusChanged?.(event)
    } catch (e) {
      setPipelineStatus(previousStatus)
      setAssignedTechId(previousTechId)
      setError(e instanceof Error ? e.message : "Could not update job pipeline")
    } finally {
      setStatusUpdating(false)
    }
  }

  const quotedPriceDollars =
    resolveQuotedPriceCents() > 0 ? Math.round(resolveQuotedPriceCents() / 100) : 0
  const baselineQuotedDollars =
    source?.baseline_quoted_price_cents != null && source.baseline_quoted_price_cents > 0
      ? Math.round(source.baseline_quoted_price_cents / 100)
      : liveQuote.totalCents > 0
        ? Math.round(liveQuote.totalCents / 100)
        : null
  const discountLabel = negotiationDiscountLabel(negotiationDiscountApplied)

  const requestClose = useCallback(() => {
    if (Date.now() - openedAtRef.current < 400) return
    onClose()
  }, [onClose])

  return (
    <>
      <SchedulerJobSlideSheet open={open && Boolean(source)} onClose={requestClose}>
        <SchedulerJobSheetCloseButton onClose={requestClose} />
        {source ? (
          viewMode === "overview" ? (
            <JobDetailOverview
              source={source}
              scheduledEvent={scheduledEvent}
              poolJob={poolJob}
              technicians={technicians}
              quotedPriceDollars={quotedPriceDollars}
              baselineQuotedDollars={baselineQuotedDollars}
              discountLabel={discountLabel}
              jobNotes={jobNotes}
              pipelineStatus={pipelineStatus}
              assignedTechId={assignedTechId}
              statusUpdating={statusUpdating}
              onEdit={() => setViewMode("edit")}
              onPipelineStatusChange={(status) => void handlePipelineControlChange({ pipelineStatus: status })}
              onAssignedTechChange={(techId) =>
                void handlePipelineControlChange({ assignedTechId: techId, pipelineStatus: "DISPATCHED" })
              }
              onClose={requestClose}
            />
          ) : (
            <JobEditWorkflow
              key={`${jobId}-edit`}
              statusLabel={statusLabel}
              lifecyclePhase={lifecyclePhase}
              customerName={customerName}
              customerPhone={customerPhone}
              location={location}
              jobNotes={jobNotes}
              serviceQuoteTypeId={serviceQuoteTypeId}
              editablePrice={editablePrice}
              saving={saving}
              deleting={deleting}
              canSave={canSave}
              error={error}
              onBackToOverview={() => setViewMode("overview")}
              onCustomerNameChange={setCustomerName}
              onCustomerPhoneChange={setCustomerPhone}
              onLocationChange={setLocation}
              onJobNotesChange={setJobNotes}
              onServiceTypeChange={handleServiceTypeChange}
              onEditablePriceChange={(value) => {
                setEditablePrice(value)
                setPriceOverridden(true)
              }}
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
    </>
  )
}
