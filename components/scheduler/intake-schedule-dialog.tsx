"use client"

// Centered modal after “Send to dispatch” — pick date/time without the swimlane grid.

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, CalendarDays, ChevronDown, Loader2, MapPin, Phone, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IntakeScheduleDayAgenda } from "@/components/scheduler/intake-schedule-day-agenda"
import {
  combineDateAndTime,
  defaultIntakeScheduleDate,
  defaultIntakeScheduleTime,
  formatIntakeScheduleVehicleLine,
  isScheduleDateTimeValid,
  parseScheduleDateKey,
  scheduleMonthKeyFromDateKey,
  scheduleTimeSlotOptions,
  suggestNextOpenTime,
} from "@/lib/intake-schedule-helpers"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import { SCHEDULER_DURATION_OPTIONS } from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type IntakeScheduleDialogProps = {
  open: boolean
  loading?: boolean
  notFound?: boolean
  job: UnassignedPoolJob | null
  technicians: FieldTechnician[]
  scheduledEvents: SchedulerEvent[]
  organizationQuery?: string
  onSchedule: (event: SchedulerEvent) => void
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
  scheduledEvents = [],
  organizationQuery = "",
  onSchedule,
  onSkip,
}: IntakeScheduleDialogProps) {
  const [dateValue, setDateValue] = useState(() => defaultIntakeScheduleDate())
  const [timeValue, setTimeValue] = useState(() => defaultIntakeScheduleTime())
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [agendaEvents, setAgendaEvents] = useState<SchedulerEvent[]>(scheduledEvents)
  const [agendaLoading, setAgendaLoading] = useState(false)

  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const timeSlotOptions = useMemo(() => scheduleTimeSlotOptions(), [])
  const selectedDate = useMemo(() => parseScheduleDateKey(dateValue), [dateValue])
  const vehicleLine = job ? formatIntakeScheduleVehicleLine(job) : null
  const canSave = Boolean(job && isScheduleDateTimeValid(dateValue, timeValue))

  const suggestedOpenTime = useMemo(() => {
    if (!job) return null
    return suggestNextOpenTime(
      agendaEvents,
      dateValue,
      durationMinutes,
      assignedTechId || null,
      job.id
    )
  }, [agendaEvents, dateValue, durationMinutes, assignedTechId, job])

  useEffect(() => {
    if (!open || !job) return
    setDateValue(defaultIntakeScheduleDate())
    setTimeValue(defaultIntakeScheduleTime())
    setDurationMinutes(job.duration_minutes ?? 60)
    setAssignedTechId("")
    setError(null)
    setSaving(false)
    setDatePickerOpen(false)
  }, [open, job?.id])

  useEffect(() => {
    setAgendaEvents(scheduledEvents)
  }, [scheduledEvents])

  useEffect(() => {
    if (!open) return
    const monthKey = scheduleMonthKeyFromDateKey(dateValue)
    if (!monthKey) return

    const monthCovered = scheduledEvents.some((ev) =>
      dayKeyLocal(new Date(ev.scheduled_at)).startsWith(monthKey)
    )
    if (monthCovered) {
      setAgendaEvents(scheduledEvents)
      return
    }

    let cancelled = false
    setAgendaLoading(true)
    void fetch(
      `/api/owner/scheduler/bootstrap?month=${encodeURIComponent(monthKey)}${organizationQuery}`,
      { credentials: "include", cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { events?: SchedulerEvent[] } }) => {
        if (cancelled) return
        setAgendaEvents(Array.isArray(j.data?.events) ? j.data!.events! : [])
      })
      .catch(() => {
        if (!cancelled) setAgendaEvents([])
      })
      .finally(() => {
        if (!cancelled) setAgendaLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, dateValue, scheduledEvents, organizationQuery])

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
        className="flex max-h-[min(92vh,820px)] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:w-full"
        overlayClassName="bg-black/45 backdrop-blur-[1px]"
        showCloseButton={!saving}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault()
        }}
      >
        <div className="border-b border-border/60 bg-emerald-500/10 px-5 py-4 sm:px-6">
          <DialogHeader className="gap-2 text-left">
            <div className="flex items-center gap-2 text-emerald-400">
              <CalendarClock className="h-5 w-5 shrink-0" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">Sent to dispatch</span>
            </div>
            <DialogTitle className="text-xl text-foreground">When should we go?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Pick date and time on the left — see what is already booked on the right so you do not double-book.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Loading job from dispatch…</p>
            </div>
          ) : null}

          {notFound && !loading ? (
            <div className="px-6 py-5">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                This job could not be found in the active pool. It may already be scheduled.
              </div>
            </div>
          ) : null}

          {job && !loading ? (
            <div className="grid min-h-[420px] md:grid-cols-2 md:divide-x md:divide-border/60">
              <div className="space-y-4 px-5 py-5 sm:px-6">
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
                    {vehicleLine ? <p className="pl-6 text-muted-foreground">{vehicleLine}</p> : null}
                    {job.location ? (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-muted-foreground">{job.location}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="grid gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Date</span>
                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={saving}
                          className="h-10 w-full justify-between border-border/70 bg-background px-3 font-normal"
                        >
                          <span className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
                            {selectedDate
                              ? selectedDate.toLocaleDateString([], {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "Pick a date"}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="z-[120] w-auto p-0"
                        align="start"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                      >
                        <Calendar
                          mode="single"
                          selected={selectedDate ?? undefined}
                          onSelect={(day) => {
                            if (!day) return
                            setDateValue(dayKeyLocal(day))
                            setDatePickerOpen(false)
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Time</span>
                    <select
                      className={fieldClass}
                      value={timeValue}
                      onChange={(e) => setTimeValue(e.target.value)}
                      disabled={saving}
                    >
                      {timeSlotOptions.map((slot) => (
                        <option key={slot.value} value={slot.value}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {suggestedOpenTime && suggestedOpenTime !== timeValue ? (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-xs text-emerald-100 transition-colors hover:bg-emerald-500/15"
                    onClick={() => setTimeValue(suggestedOpenTime)}
                    disabled={saving}
                  >
                    Suggested open slot:{" "}
                    <span className="font-semibold">
                      {timeSlotOptions.find((s) => s.value === suggestedOpenTime)?.label ?? suggestedOpenTime}
                    </span>
                  </button>
                ) : null}

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
              </div>

              <div className="flex min-h-[280px] flex-col px-5 py-5 sm:px-6 md:min-h-0">
                {agendaLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading calendar…
                  </div>
                ) : (
                  <IntakeScheduleDayAgenda
                    dateKey={dateValue}
                    timeValue={timeValue}
                    durationMinutes={durationMinutes}
                    assignedTechId={assignedTechId}
                    events={agendaEvents}
                    excludeJobId={job.id}
                    customerName={job.customer_name}
                    onPickTime={setTimeValue}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 bg-muted/10 px-5 py-4 sm:justify-between sm:px-6">
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
