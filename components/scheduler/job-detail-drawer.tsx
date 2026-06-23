"use client"

// Editable slide-over when you tap a job on the dispatch map or calendar.

import { useEffect, useMemo, useState } from "react"
import { Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { SCHEDULER_DURATION_OPTIONS, toDatetimeLocalValue } from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type JobDetailDrawerProps = {
  open: boolean
  poolJob: UnassignedPoolJob | null
  scheduledEvent: SchedulerEvent | null
  technicians: FieldTechnician[]
  onClose: () => void
  onSaved?: (event: SchedulerEvent) => void
}

const fieldBlockClass = "flex flex-col mb-4 min-w-0"
const labelClass = "text-xs font-medium text-zinc-400 mb-1.5"
const inputClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
const addressTextareaClass =
  "box-border block w-full max-w-full resize-none break-words whitespace-normal text-sm bg-zinc-900/50 border-zinc-800 min-h-[72px] rounded-lg border px-3 py-2 text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
const notesTextareaClass =
  "box-border block w-full max-w-full resize-none break-words whitespace-normal text-sm bg-zinc-900/50 border-zinc-800 min-h-[64px] rounded-lg border px-3 py-2 text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

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
  const [error, setError] = useState<string | null>(null)

  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const poolWithTech = poolJob as (UnassignedPoolJob & {
    job_status?: string | null
    assigned_tech_id?: string | null
  }) | null

  const lifecyclePhase = schedulerLifecyclePhase({
    job_status: scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null,
    dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
    assigned_tech_id: scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? null,
  })
  const statusLabel = SCHEDULER_STATUS_LABEL[lifecyclePhase]

  useEffect(() => {
    if (!source) return
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
  }, [source, scheduledEvent, poolJob, poolWithTech?.assigned_tech_id])

  if (!open || !source) return null

  const canSave = customerName.trim().length > 0 && customerPhone.trim().length > 0

  async function handleSave() {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save job")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/50" role="presentation" onClick={onClose}>
      <aside
        className={cn(
          "flex h-full w-full min-w-0 max-w-md flex-col border-l border-border bg-card shadow-xl",
          "animate-in slide-in-from-right duration-200"
        )}
        onClick={(e) => e.stopPropagation()}
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

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
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

          <div className={cn(fieldBlockClass, "w-full max-w-full")}>
            <label className={labelClass} htmlFor="job-location">
              Address
            </label>
            <Textarea
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

          <div className={fieldBlockClass}>
            <label className={labelClass} htmlFor="job-start">
              Start time
            </label>
            <Input
              id="job-start"
              type="datetime-local"
              className={inputClass}
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>

          <div className={cn(fieldBlockClass, "mb-0")}>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col">
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
              <div className="flex min-w-0 flex-col">
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

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex gap-2 border-t border-border/60 px-5 py-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={() => void handleSave()} disabled={!canSave || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
          </Button>
        </div>
      </aside>
    </div>
  )
}
