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
import { JobEditWorkflow, type JobEditWorkflowStep } from "@/components/scheduler/job-edit-workflow"
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
  dispatchJobTypeFromServiceQuoteTypeId,
  serviceQuoteTypeFromJobType,
} from "@/lib/job-intake-fields"
import { calculateServiceQuote, type ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"
import type { ServiceRateCard } from "@/lib/service-rate-card"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import type { VehicleClarificationOption } from "@/lib/vehicle-intake-clarifications"
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
  const [answeredClarificationIds, setAnsweredClarificationIds] = useState<string[]>([])
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
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localJobStatus, setLocalJobStatus] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<JobDetailViewMode>("overview")
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null)
  const startInputRef = useRef<HTMLInputElement>(null)
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
    resolveQuotedPriceCents,
    serviceQuoteTypeId,
    travelDistanceMilesValue,
    vehicleMake,
    vehicleModel,
    vehicleYear,
  ])

  const clearKeySelection = useCallback(() => {
    setKeyFccId("")
    setKeyFrequency("")
    setKeyChipset("")
    setKeyStyle("")
    setKeyVariantId("")
    setKeyProfileId("")
  }, [])

  const setVehicle = useCallback(
    (vehicle: { vehicle_year: string; vehicle_make: string; vehicle_model: string }) => {
      setVehicleYear(vehicle.vehicle_year)
      setVehicleMake(vehicle.vehicle_make)
      setVehicleModel(vehicle.vehicle_model)
      clearKeySelection()
      setAnsweredClarificationIds([])
    },
    [clearKeySelection]
  )

  const applyVehicleClarification = useCallback(
    (promptId: string, option: VehicleClarificationOption) => {
      setAnsweredClarificationIds((prev) =>
        prev.includes(promptId) ? prev : [...prev, promptId]
      )
      if (option.make?.trim()) setVehicleMake(option.make.trim())
      if (option.model?.trim()) setVehicleModel(option.model.trim())
      const noteLine = option.note?.trim()
      if (noteLine && !jobNotes.includes(noteLine)) {
        setJobNotes((prev) => (prev.trim() ? `${prev.trim()} · ${noteLine}` : noteLine))
      }
      if (option.model || option.make) clearKeySelection()
    },
    [clearKeySelection, jobNotes]
  )

  const setVehicleKeySelection = useCallback(
    (
      sel: {
        profileId: string
        fccId: string
        frequency: string | null
        chipset: string | null
        keyStyle: string
        variantId?: string | null
      } | null
    ) => {
      setKeyProfileId(sel?.profileId ?? "")
      setKeyFccId(sel?.fccId ?? "")
      setKeyFrequency(sel?.frequency ?? "")
      setKeyChipset(sel?.chipset ?? "")
      setKeyStyle(sel?.keyStyle ?? "")
      setKeyVariantId(sel?.variantId ?? "")
    },
    []
  )

  const handleServiceTypeChange = useCallback((id: ServiceQuoteTypeId) => {
    setServiceQuoteTypeId(id)
    setPriceOverridden(false)
  }, [])

  const handleNegotiationApply = useCallback((dollars: number, discountId: NegotiationDiscountId) => {
    setEditablePrice(String(dollars))
    setPriceOverridden(true)
    setNegotiationDiscountApplied(discountId)
  }, [])

  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

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

  const hasAssignedTech = Boolean(
    scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? assignedTechId.trim()
  )

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
    setAnsweredClarificationIds([])
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
    setViewMode(scheduleIntent ? "edit" : "overview")
    setAssigningTechId(null)
    setError(null)
    userPickedScheduleRef.current = false
    lastAutoSavedLocalRef.current = null
  }, [source, scheduledEvent, poolJob, poolWithTech?.assigned_tech_id, scheduleIntent])

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
    if (!scheduleIntent || !open) return
    const timer = window.setTimeout(() => startInputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [scheduleIntent, open, jobId])

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

  async function handleStatusChange(
    nextStatus: "assigned" | "en_route" | "arrived" | "completed"
  ) {
    if (!jobId || statusUpdating) return
    if (nextStatus !== "completed" && !hasAssignedTech) {
      setError("Assign a technician before updating field status.")
      return
    }
    setStatusUpdating(true)
    setError(null)
    setLocalJobStatus(nextStatus)
    try {
      const res = await fetch(`/api/owner/jobs/${encodeURIComponent(jobId)}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not update status")
      const event = json.data?.event
      if (event) {
        setLocalJobStatus(event.job_status ?? nextStatus)
        onStatusChanged?.(event)
      }
    } catch (e) {
      setLocalJobStatus(scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null)
      setError(e instanceof Error ? e.message : "Could not update status")
    } finally {
      setStatusUpdating(false)
    }
  }

  async function handleSave(options?: { fromScheduleIntent?: boolean }) {
    if (!jobId || !canSave) return
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
      onSaved?.(event)
      setViewMode("overview")
      if (options?.fromScheduleIntent) {
        lastAutoSavedLocalRef.current = startLocal.trim()
        onScheduleCommitted?.(event)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save job")
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

  async function handleQuickAssignTech(techUserId: string) {
    if (!jobId || !canSave) return
    const nextTechId = techUserId.trim()
    setAssigningTechId(nextTechId || "__unassigned__")
    setAssignedTechId(nextTechId)
    setError(null)
    try {
      const body = buildSaveBody()
      body.assigned_tech_id = nextTechId || null
      const res = await fetch(`/api/owner/scheduler/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not assign technician")
      const event = json.data?.event
      if (event) onSaved?.(event)
    } catch (e) {
      setAssignedTechId(scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? "")
      setError(e instanceof Error ? e.message : "Could not assign technician")
    } finally {
      setAssigningTechId(null)
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
  const editInitialStep: JobEditWorkflowStep = scheduleIntent ? "DISPATCH" : "CUSTOMER"

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
              assignedTechId={assignedTechId}
              statusUpdating={statusUpdating}
              assigningTechId={assigningTechId}
              onEdit={() => setViewMode("edit")}
              onAssignTech={(techId) => void handleQuickAssignTech(techId)}
              onClose={requestClose}
            />
          ) : (
            <JobEditWorkflow
              key={`${jobId}-edit`}
              statusLabel={statusLabel}
              lifecyclePhase={lifecyclePhase}
              initialStep={editInitialStep}
              customerName={customerName}
              customerPhone={customerPhone}
              location={location}
              jobNotes={jobNotes}
              serviceQuoteTypeId={serviceQuoteTypeId}
              vehicleYear={vehicleYear}
              vehicleMake={vehicleMake}
              vehicleModel={vehicleModel}
              keyFccId={keyFccId}
              keyFrequency={keyFrequency}
              keyChipset={keyChipset}
              keyStyle={keyStyle}
              keyVariantId={keyVariantId}
              keyProfileId={keyProfileId}
              answeredClarificationIds={answeredClarificationIds}
              editablePrice={editablePrice}
              priceOverridden={priceOverridden}
              negotiationDiscountApplied={negotiationDiscountApplied}
              liveQuote={liveQuote}
              startLocal={startLocal}
              durationMinutes={durationMinutes}
              assignedTechId={assignedTechId}
              assignableTechs={assignableTechs}
              hasAssignedTech={hasAssignedTech}
              statusUpdating={statusUpdating}
              saving={saving}
              deleting={deleting}
              canSave={canSave}
              error={error}
              startInputRef={startInputRef}
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
              onEditablePriceBlur={() => {
                if (!editablePrice.trim()) {
                  setPriceOverridden(false)
                  setEditablePrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
                }
              }}
              onNegotiationApply={handleNegotiationApply}
              onVehicleChange={setVehicle}
              onVehicleClarification={applyVehicleClarification}
              onVehicleKeySelection={setVehicleKeySelection}
              onStartLocalChange={(value) => {
                userPickedScheduleRef.current = true
                setStartLocal(value)
              }}
              onDurationChange={setDurationMinutes}
              onAssignedTechChange={setAssignedTechId}
              onStatusChange={(status) => void handleStatusChange(status)}
              onSave={() => void handleSave()}
              onDeleteRequest={() => setDeleteConfirmOpen(true)}
              onClose={requestClose}
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
