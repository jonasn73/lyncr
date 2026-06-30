"use client"

// Centered modal after “Send to dispatch” — pick date/time without the swimlane grid.

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, Loader2, MapPin, Phone, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  combineDateAndTime,
  defaultIntakeScheduleDate,
  defaultIntakeScheduleTime,
  formatIntakeScheduleVehicleLine,
  isScheduleDateTimeValid,
} from "@/lib/intake-schedule-helpers"
import { SCHEDULER_DURATION_OPTIONS } from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type IntakeScheduleDialogProps = {
  /** Whether the dialog should be visible (post-intake deep link). */
  open: boolean
  /** Pool job still loading from the API. */
  loading?: boolean
  /** True when the pool loaded but the focused job id was not found. */
  notFound?: boolean
  /** Unassigned pool job to schedule (null while loading). */
  job: UnassignedPoolJob | null
  /** Active field techs for optional assignment. */
  technicians: FieldTechnician[]
  /** Called after a successful save — parent navigates to the map. */
  onSchedule: (event: SchedulerEvent) => void
  /** Leave job in the pool and go to the map unscheduled. */
  onSkip: () => void
}

const fieldClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

function formatPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

export function IntakeScheduleDialog({
  open,
  loading = false,
  notFound = false,
  job,
  technicians,
  onSchedule,
  onSkip,
}: IntakeScheduleDialogProps) {
  const [dateValue, setDateValue] = useState(() => defaultIntakeScheduleDate())
  const [timeValue, setTimeValue] = useState(() => defaultIntakeScheduleTime())
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const vehicleLine = job ? formatIntakeScheduleVehicleLine(job) : null
  const canSave = Boolean(job && isScheduleDateTimeValid(dateValue, timeValue))

  useEffect(() => {
    if (!open || !job) return
    setDateValue(defaultIntakeScheduleDate())
    setTimeValue(defaultIntakeScheduleTime())
    setDurationMinutes(job.duration_minutes ?? 60)
    setAssignedTechId("")
    setError(null)
    setSaving(false)
  }, [open, job?.id])

  async function handleSchedule() {
    if (!job || !canSave) return
    setSaving(true)
    setError(null)
    try {
      const startLocal = combineDateAndTime(dateValue, timeValue)
      const body: Record<string, unknown> = {
        customer_name: (job.customer_name ?? "").trim(),
        customer_phone: (job.customer_phone ?? "").trim(),
        job_type: (job.job_type ?? "Other").trim() || "Other",
        duration_minutes: durationMinutes,
        vehicle_year: job.vehicle_year ?? null,
        vehicle_make: job.vehicle_make ?? null,
        vehicle_model: job.vehicle_model ?? null,
        job_address: job.location ?? null,
        job_notes: job.job_notes ?? null,
        assigned_tech_id: assignedTechId.trim() || null,
        scheduled_at: new Date(startLocal).toISOString(),
      }
      const res = await fetch(`/api/owner/scheduler/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not schedule job")
      const event = json.data?.event
      if (!event) throw new Error("No updated job returned")
      onSchedule(event)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not schedule job")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onSkip()
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-md"
        showCloseButton={!saving}
        onPointerDownOutside={(e) => {
          if (saving) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault()
        }}
      >
        <div className="border-b border-border/60 bg-emerald-500/10 px-6 py-5">
          <DialogHeader className="gap-2 text-left">
            <div className="flex items-center gap-2 text-emerald-400">
              <CalendarClock className="h-5 w-5 shrink-0" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">Sent to dispatch</span>
            </div>
            <DialogTitle className="text-xl text-foreground">When should we go?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Pick a day and time now — no need to drag onto the grid or add technicians first.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Loading job from dispatch…</p>
            </div>
          ) : null}

          {notFound && !loading ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This job could not be found in the active pool. It may already be scheduled.
            </div>
          ) : null}

          {job && !loading ? (
            <>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Customer
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-medium text-foreground">{job.customer_name ?? "Unknown"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-muted-foreground">{formatPhone(job.customer_phone)}</span>
                  </div>
                  {vehicleLine ? (
                    <p className="pl-6 text-muted-foreground">{vehicleLine}</p>
                  ) : null}
                  {job.location ? (
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="text-muted-foreground">{job.location}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Date</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Time</span>
                  <input
                    type="time"
                    className={fieldClass}
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                    disabled={saving}
                    step={900}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Duration</span>
                  <select
                    className={fieldClass}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    disabled={saving}
                  >
                    {SCHEDULER_DURATION_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Assign tech</span>
                  <select
                    className={cn(fieldClass, assignableTechs.length === 0 && "opacity-70")}
                    value={assignedTechId}
                    onChange={(e) => setAssignedTechId(e.target.value)}
                    disabled={saving || assignableTechs.length === 0}
                  >
                    <option value="">Unassigned</option>
                    {assignableTechs.map((t) => (
                      <option key={t.id} value={t.portal_user_id ?? ""}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {assignableTechs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active technicians yet — you can still set a time and assign someone later in Team.
                </p>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 bg-muted/10 px-6 py-4 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onSkip} disabled={saving || loading}>
            Skip for now
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-500"
            onClick={() => void handleSchedule()}
            disabled={saving || loading || notFound || !canSave}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Schedule &amp; view map
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
