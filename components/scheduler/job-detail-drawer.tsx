"use client"

// Editable slide-over when you tap a job on the dispatch map or calendar.

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
const sectionClass = "mb-4 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4"
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

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [jobType, setJobType] = useState("")
  const [vehicleYear, setVehicleYear] = useState("")
  const [vehicleMake, setVehicleMake] = useState("")
  const [vehicleModel, setVehicleModel] = useState("")
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
    setJobType(source.job_type ?? "")
    setVehicleYear(source.vehicle_year ?? "")
    setVehicleMake(source.vehicle_make ?? "")
    setVehicleModel(source.vehicle_model ?? "")
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
          const body: Record<string, unknown> = {
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim(),
            job_type: jobType.trim() || "Other",
            duration_minutes: durationMinutes,
            vehicle_year: vehicleYear.trim() || null,
            vehicle_make: vehicleMake.trim() || null,
            vehicle_model: vehicleModel.trim() || null,
            job_address: location.trim() || null,
            job_notes: jobNotes.trim() || null,
            assigned_tech_id: assignedTechId.trim() || null,
            scheduled_at: new Date(startLocal).toISOString(),
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
    jobType,
    durationMinutes,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    location,
    jobNotes,
    assignedTechId,
    onSaved,
    onScheduleCommitted,
  ])

  // Lock page scroll while the editor is open (drawer is portaled to document.body).
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open || !source) return null

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
      const body: Record<string, unknown> = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        job_type: jobType.trim() || "Other",
        duration_minutes: durationMinutes,
        vehicle_year: vehicleYear.trim() || null,
        vehicle_make: vehicleMake.trim() || null,
        vehicle_model: vehicleModel.trim() || null,
        job_address: location.trim() || null,
        job_notes: jobNotes.trim() || null,
        assigned_tech_id: assignedTechId.trim() || null,
      }
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
      onDeleted?.(jobId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete job")
    } finally {
      setDeleting(false)
    }
  }

  // Portal to body so Leaflet map stacking cannot hide the editor panel.
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close job editor"
        className="scheduler-job-detail-overlay fixed inset-0 z-[1400] bg-zinc-950/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit job"
        className="scheduler-job-detail-panel fixed inset-y-0 right-0 z-[1410] flex w-full max-w-md flex-col border-l border-border/60 bg-background shadow-lg"
      >
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

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
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
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-type">
                  Service type
                </label>
                <Input
                  id="job-type"
                  className={inputClass}
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                  placeholder="Key replacement"
                />
              </div>

              <div className={fieldBlockClass}>
                <label className={labelClass}>Vehicle specs</label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex min-w-0 flex-col">
                    <label className={labelClass} htmlFor="job-vehicle-year">
                      Year
                    </label>
                    <Input
                      id="job-vehicle-year"
                      className={inputClass}
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                      placeholder="2023"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <label className={labelClass} htmlFor="job-vehicle-make">
                      Make
                    </label>
                    <Input
                      id="job-vehicle-make"
                      className={inputClass}
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                      placeholder="Honda"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <label className={labelClass} htmlFor="job-vehicle-model">
                      Model
                    </label>
                    <Input
                      id="job-vehicle-model"
                      className={inputClass}
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Civic"
                    />
                  </div>
                </div>
              </div>

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

        <div className="flex flex-col gap-2 border-t border-border/60 px-5 py-4">
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
      </div>

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
    </>,
    document.body
  )
}
