"use client"

// Editable slide-over when you tap a job on the dispatch map or calendar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Trash2, X } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { VehicleIntakeClarificationsPanel } from "@/components/vehicle-intake-clarifications-panel"
import { VehicleKeyInfoPanel } from "@/components/vehicle-key-info-panel"
import { ServiceQuoteCalculatorPanel } from "@/components/dashboard/service-quote-calculator-panel"
import { PriceNegotiationHelperPanel } from "@/components/price-negotiation-helper-panel"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import {
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
  type SchedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { SCHEDULER_DURATION_OPTIONS, toDatetimeLocalValue } from "@/lib/scheduler-utils"
import { shouldAutoAdvanceAfterSchedulePick } from "@/lib/scheduler-focus-url"
import { cn } from "@/lib/utils"
import {
  dispatchJobTypeFromServiceQuoteTypeId,
  serviceQuoteTypeFromJobType,
  serviceTypeRequiresVehicle,
} from "@/lib/job-intake-fields"
import { calculateServiceQuote, type ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"
import type { ServiceRateCard } from "@/lib/service-rate-card"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import type { VehicleClarificationOption } from "@/lib/vehicle-intake-clarifications"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

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

const STATUS_SEGMENTS: {
  phase: SchedulerLifecyclePhase
  jobStatus: "assigned" | "en_route" | "arrived" | "completed"
  label: string
}[] = [
  { phase: "scheduled", jobStatus: "assigned", label: "Assigned" },
  { phase: "en_route", jobStatus: "en_route", label: "En route" },
  { phase: "on_site", jobStatus: "arrived", label: "On site" },
  { phase: "completed", jobStatus: "completed", label: "Completed" },
]

const fieldBlockClass = "flex w-full min-w-0 flex-col"
const labelClass = "mb-1.5 text-xs font-medium text-zinc-400"
const sectionClass = "mb-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4"
const sectionTitleClass = "mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
const addressTextareaClass =
  "box-border block min-h-[72px] w-full max-w-full resize-none break-words whitespace-normal rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
const notesTextareaClass = addressTextareaClass

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

  const requiresVehicle = serviceTypeRequiresVehicle(serviceQuoteTypeId)

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
    setError(null)
    userPickedScheduleRef.current = false
    lastAutoSavedLocalRef.current = null
  }, [source, scheduledEvent, poolJob, poolWithTech?.assigned_tech_id])

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

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  const canSave = customerName.trim().length > 0 && customerPhone.trim().length > 0

  async function handleStatusChange(nextStatus: (typeof STATUS_SEGMENTS)[number]["jobStatus"]) {
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

  return (
    <>
      <Dialog
        open={open && Boolean(source)}
        onOpenChange={(next) => {
          if (next) return
          if (Date.now() - openedAtRef.current < 400) return
          onClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-zinc-950/75"
          className="!flex h-[min(92dvh,880px)] w-full max-w-lg flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-lg"
          onPointerDownOutside={(event) => {
            if (Date.now() - openedAtRef.current < 400) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (Date.now() - openedAtRef.current < 400) event.preventDefault()
          }}
        >
          <DialogTitle className="sr-only">Edit job</DialogTitle>
          <header className="relative shrink-0 border-b border-border/60 px-5 py-4 pr-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Job details</p>
          <span
            className={cn(
              "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              lifecyclePhase === "unassigned" && "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
              lifecyclePhase === "scheduled" && "bg-teal-500/20 text-teal-100 ring-1 ring-teal-500/30",
              lifecyclePhase === "en_route" && "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/30",
              lifecyclePhase === "on_site" && "bg-yellow-500/20 text-yellow-100 ring-1 ring-yellow-500/30",
              lifecyclePhase === "completed" && "bg-zinc-600/30 text-zinc-400 ring-1 ring-zinc-600/40"
            )}
          >
            {statusLabel}
          </span>

          <button
            type="button"
            aria-label="Close"
            className="absolute right-3 top-3 rounded-lg p-2 text-zinc-500 hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-4">
          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Customer Information</h3>
            <div className="space-y-3">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-customer-name">
                  Customer name
                </label>
                <Input
                  id="job-customer-name"
                  className={inputClass}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-customer-phone">
                  Phone
                </label>
                <Input
                  id="job-customer-phone"
                  type="tel"
                  className={inputClass}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(502) 555-0100"
                />
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Service Profile</h3>
            <div className="space-y-3">
              <ServiceQuoteCalculatorPanel
                quote={liveQuote}
                serviceTypeId={serviceQuoteTypeId}
                vehicleYear={vehicleYear}
                vehicleMake={vehicleMake}
                vehicleModel={vehicleModel}
                onServiceTypeChange={handleServiceTypeChange}
                className="border-emerald-500/20 bg-emerald-500/[0.07]"
              />

              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
                <Label
                  htmlFor="job-quote-price"
                  className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90"
                >
                  Quote before dispatch
                </Label>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold text-emerald-400/80">
                    $
                  </span>
                  <input
                    id="job-quote-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    value={editablePrice}
                    onChange={(e) => {
                      setEditablePrice(e.target.value)
                      setPriceOverridden(true)
                    }}
                    onBlur={() => {
                      if (!editablePrice.trim()) {
                        setPriceOverridden(false)
                        setEditablePrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
                      }
                    }}
                    className="w-full border-none bg-transparent pl-7 text-center text-4xl font-bold text-emerald-400 focus:outline-none focus:ring-0"
                  />
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  {priceOverridden
                    ? "Custom quote — edit before saving."
                    : `Auto-calculated: ${liveQuote.dispatchJobTypeLabel}${
                        liveQuote.distanceMiles != null
                          ? ` + ${liveQuote.distanceMiles.toFixed(1)} mi travel`
                          : ""
                      }.`}
                </p>
              </div>

              <PriceNegotiationHelperPanel
                baselineCents={liveQuote.totalCents}
                currentPriceDollars={editablePrice}
                onApplyPrice={handleNegotiationApply}
                appliedDiscountId={negotiationDiscountApplied}
              />

              {requiresVehicle ? (
                <fieldset className="@container grid min-w-0 max-w-full gap-3 overflow-hidden rounded-lg border border-primary/40 bg-primary/10 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    Vehicle metadata
                  </legend>
                  <VehiclePickerCascade
                    value={{
                      vehicle_year: vehicleYear,
                      vehicle_make: vehicleMake,
                      vehicle_model: vehicleModel,
                    }}
                    onChange={setVehicle}
                  />
                  <VehicleIntakeClarificationsPanel
                    year={vehicleYear}
                    make={vehicleMake}
                    model={vehicleModel}
                    answeredIds={new Set(answeredClarificationIds)}
                    onAnswer={applyVehicleClarification}
                  />
                  <VehicleKeyInfoPanel
                    year={vehicleYear}
                    make={vehicleMake}
                    model={vehicleModel}
                    value={
                      keyFccId
                        ? {
                            profileId: keyProfileId,
                            fccId: keyFccId,
                            frequency: keyFrequency || null,
                            chipset: keyChipset || null,
                            keyStyle: keyStyle || "Not sure yet",
                            variantId: keyVariantId || null,
                          }
                        : null
                    }
                    onChange={(sel) => setVehicleKeySelection(sel)}
                  />
                </fieldset>
              ) : null}
            </div>
          </section>

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Dispatch &amp; schedule</h3>
            <div className="space-y-3">
              <div className={fieldBlockClass}>
                <label className={labelClass}>Status controls</label>
                <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {STATUS_SEGMENTS.map((segment) => {
                    const active = lifecyclePhase === segment.phase
                    const disabled =
                      statusUpdating ||
                      (segment.jobStatus !== "completed" && !hasAssignedTech && segment.phase !== "scheduled")
                    return (
                      <button
                        key={segment.jobStatus}
                        type="button"
                        disabled={disabled}
                        onClick={() => void handleStatusChange(segment.jobStatus)}
                        className={cn(
                          "flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-zinc-400 hover:bg-zinc-800/80 hover:text-foreground",
                          disabled && !active && "cursor-not-allowed opacity-40"
                        )}
                      >
                        {segment.label}
                      </button>
                    )
                  })}
                </div>
                {statusUpdating ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Updating status…
                  </p>
                ) : null}
              </div>

              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-start">
                  Start time
                </label>
                <Input
                  id="job-start"
                  ref={startInputRef}
                  type="datetime-local"
                  className={inputClass}
                  value={startLocal}
                  onChange={(e) => {
                    userPickedScheduleRef.current = true
                    setStartLocal(e.target.value)
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={fieldBlockClass}>
                  <label className={labelClass} htmlFor="job-duration">
                    Duration
                  </label>
                  <select
                    id="job-duration"
                    className={inputClass}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value) || 60)}
                  >
                    {SCHEDULER_DURATION_OPTIONS.map((opt) => (
                      <option key={opt.minutes} value={opt.minutes}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={fieldBlockClass}>
                  <label className={labelClass} htmlFor="job-tech">
                    Assigned tech
                  </label>
                  <select
                    id="job-tech"
                    className={inputClass}
                    value={assignedTechId}
                    onChange={(e) => setAssignedTechId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {assignableTechs.map((t) => (
                      <option key={t.portal_user_id!} value={t.portal_user_id!}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className={cn(sectionClass, "mb-0")}>
            <h3 className={sectionTitleClass}>Logistics</h3>
            <div className="space-y-3">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-location">
                  Address
                </label>
                <textarea
                  id="job-location"
                  className={addressTextareaClass}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Street address"
                  rows={3}
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-notes">
                  Notes
                </label>
                <Textarea
                  id="job-notes"
                  className={notesTextareaClass}
                  value={jobNotes}
                  onChange={(e) => setJobNotes(e.target.value)}
                  placeholder="Gate code, symptoms, etc."
                  rows={2}
                />
              </div>
            </div>
          </section>

          {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border/60 bg-card px-5 py-4">
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void handleSave()}
              disabled={!canSave || saving || deleting}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={saving || deleting}
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
            Delete job
          </Button>
        </div>
        </DialogContent>
      </Dialog>

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
