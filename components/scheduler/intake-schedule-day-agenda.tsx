"use client"

// Right-hand panel: shows what is already booked on the selected day.

import { AlertTriangle, Clock3 } from "lucide-react"
import {
  eventsOnScheduleDay,
  findScheduleConflicts,
  formatSchedulerEventWindow,
  parseScheduleDateKey,
} from "@/lib/intake-schedule-helpers"
import { cn } from "@/lib/utils"
import type { SchedulerEvent } from "@/lib/types"

type IntakeScheduleDayAgendaProps = {
  dateKey: string
  timeValue: string
  durationMinutes: number
  assignedTechId: string
  events: SchedulerEvent[]
  excludeJobId?: string | null
  customerName?: string | null
  onPickTime: (timeValue: string) => void
}

export function IntakeScheduleDayAgenda({
  dateKey,
  timeValue,
  durationMinutes,
  assignedTechId,
  events,
  excludeJobId,
  customerName,
  onPickTime,
}: IntakeScheduleDayAgendaProps) {
  const dayDate = parseScheduleDateKey(dateKey)
  const dayLabel = dayDate
    ? dayDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
    : dateKey

  const dayEvents = eventsOnScheduleDay(events, dateKey, excludeJobId)
  const conflicts = findScheduleConflicts(
    events,
    dateKey,
    timeValue,
    durationMinutes,
    assignedTechId || null,
    excludeJobId
  )

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border/60 bg-muted/10">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Already booked</p>
        <p className="mt-1 text-sm font-medium text-foreground">{dayLabel}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {dayEvents.length === 0
            ? "Nothing scheduled yet — pick any time."
            : `${dayEvents.length} job${dayEvents.length === 1 ? "" : "s"} on the calendar.`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Clock3 className="h-8 w-8 opacity-40" aria-hidden />
            <p>Your day is open.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {dayEvents.map((ev) => {
              const isConflict = conflicts.some((c) => c.id === ev.id)
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const start = new Date(ev.scheduled_at)
                      const after = new Date(start.getTime() + Math.max(ev.duration_minutes, 15) * 60_000)
                      const h = String(after.getHours()).padStart(2, "0")
                      const mi = String(after.getMinutes()).padStart(2, "0")
                      onPickTime(`${h}:${mi}`)
                    }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      isConflict
                        ? "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
                        : "border-border/60 bg-background/60 hover:bg-background"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatSchedulerEventWindow(ev)}
                      </span>
                      {isConflict ? (
                        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                          Overlap
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">
                      {ev.customer_name ?? "Customer"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ev.assigned_tech_name ? ev.assigned_tech_name : "Unassigned"}
                      {ev.job_type ? ` · ${ev.job_type}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">Tap to start after this job</p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {timeValue && conflicts.length > 0 ? (
          <div className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
            <p>
              {customerName ?? "This job"} overlaps {conflicts.length} existing booking
              {conflicts.length === 1 ? "" : "s"}. You can still schedule it — adjust time if needed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
