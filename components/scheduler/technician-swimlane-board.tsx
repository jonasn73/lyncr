"use client"

// Per-tech schedule board — desktop vertical swimlanes + mobile horizontal timeline.

import { useMemo, useState } from "react"
import { Loader2, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { HOPPER_DRAG_MIME } from "@/components/scheduler/job-pool-card"
import {
  SCHEDULER_CARD_STYLE,
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import {
  SCHEDULER_GRID_START_HOUR,
  SCHEDULER_HOUR_COL_PX,
  SCHEDULER_HOUR_ROW_PX,
  SCHEDULER_TECH_ROW_PX,
  formatHourLabel,
  schedulerEventHorizontalPlacement,
  schedulerEventPlacement,
  schedulerHourSlots,
} from "@/lib/scheduler-utils"
import type { FieldTechnician, SchedulerEvent } from "@/lib/types"

type TechnicianSwimlaneBoardProps = {
  technicians: FieldTechnician[]
  dayEvents: SchedulerEvent[]
  loading?: boolean
  highlightId?: string | null
  onSelectEvent?: (event: SchedulerEvent) => void
  onDropPoolJob?: (jobId: string, techUserId: string, hour24: number) => void
  onBookEmptySlot?: (techUserId: string, hour24: number) => void
}

function formatBlockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function formatVehicle(ev: SchedulerEvent): string | null {
  const parts = [ev.vehicle_year, ev.vehicle_make, ev.vehicle_model].filter(Boolean)
  return parts.length ? parts.join(" ") : null
}

function eventCardStyle(ev: SchedulerEvent): string {
  const phase = schedulerLifecyclePhase({
    job_status: ev.job_status,
    dispatch_status: ev.dispatch_status,
    assigned_tech_id: ev.assigned_tech_id,
  })
  return SCHEDULER_CARD_STYLE[phase]
}

function SwimlaneAppointmentBlock({
  ev,
  highlighted,
  onSelect,
}: {
  ev: SchedulerEvent
  highlighted?: boolean
  onSelect?: () => void
}) {
  const vehicle = formatVehicle(ev)
  const { topPx, heightPx } = schedulerEventPlacement(
    ev.scheduled_at,
    ev.duration_minutes,
    ev.scheduled_tentative
  )
  const phase = schedulerLifecyclePhase({
    job_status: ev.job_status,
    dispatch_status: ev.dispatch_status,
    assigned_tech_id: ev.assigned_tech_id,
  })

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      className={cn(
        "absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-lg border px-2 py-1 shadow-md",
        onSelect ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        eventCardStyle(ev)
      )}
      style={{ top: topPx, height: heightPx, minHeight: 36 }}
    >
      <p className="truncate text-[11px] font-semibold">
        {ev.customer_name || "Customer"}
        <span className="ml-1 text-[9px] font-medium uppercase opacity-75">
          · {SCHEDULER_STATUS_LABEL[phase]}
        </span>
      </p>
      <p className="truncate text-[10px] opacity-90">{vehicle || ev.job_type || "Appointment"}</p>
      <p className="text-[10px] opacity-75">
        {formatBlockTime(ev.scheduled_at)}
        {ev.duration_minutes ? ` · ${ev.duration_minutes}m` : ""}
      </p>
    </div>
  )
}

function TimelineAppointmentBlock({
  ev,
  highlighted,
  onSelect,
}: {
  ev: SchedulerEvent
  highlighted?: boolean
  onSelect?: () => void
}) {
  const { leftPx, widthPx } = schedulerEventHorizontalPlacement(
    ev.scheduled_at,
    ev.duration_minutes,
    ev.scheduled_tentative
  )
  const phase = schedulerLifecyclePhase({
    job_status: ev.job_status,
    dispatch_status: ev.dispatch_status,
    assigned_tech_id: ev.assigned_tech_id,
  })

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "absolute top-1 z-10 min-h-[44px] overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-md",
        highlighted && "ring-2 ring-primary",
        eventCardStyle(ev)
      )}
      style={{ left: leftPx, width: widthPx, minWidth: 56 }}
    >
      <p className="truncate text-[10px] font-semibold">{ev.customer_name || "Job"}</p>
      <p className="truncate text-[9px] opacity-80">{SCHEDULER_STATUS_LABEL[phase]}</p>
    </button>
  )
}

function MobileTimelineBoard({
  assignableTechs,
  eventsByTech,
  hourSlots,
  timelineWidthPx,
  highlightId,
  loading,
  dragOverCell,
  setDragOverCell,
  onSelectEvent,
  onDropPoolJob,
  onBookEmptySlot,
}: {
  assignableTechs: FieldTechnician[]
  eventsByTech: Map<string, SchedulerEvent[]>
  hourSlots: number[]
  timelineWidthPx: number
  highlightId?: string | null
  loading?: boolean
  dragOverCell: { techId: string; hour: number } | null
  setDragOverCell: (cell: { techId: string; hour: number } | null) => void
  onSelectEvent?: (event: SchedulerEvent) => void
  onDropPoolJob?: (jobId: string, techUserId: string, hour24: number) => void
  onBookEmptySlot?: (techUserId: string, hour24: number) => void
}) {
  const techColWidth = 112

  return (
    <div className="flex max-h-[min(480px,55vh)] flex-1 flex-col overflow-hidden md:hidden">
      <div className="overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex min-w-full flex-col" style={{ minWidth: techColWidth + timelineWidthPx }}>
          <div className="flex border-b border-border/40 bg-card/95">
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-border/40 bg-card px-2 py-2"
              style={{ width: techColWidth }}
            >
              <span className="text-[10px] font-semibold uppercase text-zinc-500">Tech</span>
            </div>
            <div className="relative shrink-0" style={{ width: timelineWidthPx }}>
              <div className="flex">
                {hourSlots.map((hour) => (
                  <div
                    key={hour}
                    className="shrink-0 border-r border-border/30 px-1 py-2 text-center text-[9px] font-medium text-zinc-500"
                    style={{ width: SCHEDULER_HOUR_COL_PX }}
                  >
                    {formatHourLabel(hour)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {assignableTechs.map((tech) => {
            const techUserId = tech.portal_user_id!
            const laneEvents = eventsByTech.get(techUserId) ?? []

            return (
              <div key={tech.id} className="flex border-b border-border/30">
                <div
                  className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-border/40 bg-card px-2 py-2"
                  style={{ width: techColWidth, minHeight: SCHEDULER_TECH_ROW_PX }}
                >
                  <p className="truncate text-xs font-semibold">{tech.name}</p>
                  <p className="text-[9px] text-zinc-500">{laneEvents.length} today</p>
                </div>
                <div
                  className="relative shrink-0 bg-muted/10"
                  style={{ width: timelineWidthPx, height: SCHEDULER_TECH_ROW_PX }}
                >
                  {hourSlots.map((hour) => {
                    const isOver = dragOverCell?.techId === techUserId && dragOverCell.hour === hour
                    return (
                      <button
                        key={hour}
                        type="button"
                        aria-label={`Assign to ${tech.name} at ${formatHourLabel(hour)}`}
                        className={cn(
                          "absolute top-0 min-h-[44px] border-r border-border/20 transition active:bg-primary/10",
                          isOver && "bg-primary/15 ring-2 ring-inset ring-primary/50"
                        )}
                        style={{
                          left: (hour - SCHEDULER_GRID_START_HOUR) * SCHEDULER_HOUR_COL_PX,
                          width: SCHEDULER_HOUR_COL_PX,
                          height: SCHEDULER_TECH_ROW_PX,
                        }}
                        onClick={() => onBookEmptySlot?.(techUserId, hour)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = "move"
                          setDragOverCell({ techId: techUserId, hour })
                        }}
                        onDragLeave={() => {
                          setDragOverCell((cell) =>
                            cell?.techId === techUserId && cell.hour === hour ? null : cell
                          )
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverCell(null)
                          const jobId = e.dataTransfer.getData(HOPPER_DRAG_MIME)
                          if (!jobId) return
                          onDropPoolJob?.(jobId, techUserId, hour)
                        }}
                      />
                    )
                  })}
                  {laneEvents.map((ev) => (
                    <TimelineAppointmentBlock
                      key={ev.id}
                      ev={ev}
                      highlighted={highlightId === ev.id}
                      onSelect={() => onSelectEvent?.(ev)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 border-t border-border/40 py-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading schedule…
        </div>
      ) : null}
    </div>
  )
}

export function TechnicianSwimlaneBoard({
  technicians,
  dayEvents,
  loading,
  highlightId,
  onSelectEvent,
  onDropPoolJob,
  onBookEmptySlot,
}: TechnicianSwimlaneBoardProps) {
  const hourSlots = schedulerHourSlots()
  const gridHeightPx = hourSlots.length * SCHEDULER_HOUR_ROW_PX
  const timelineWidthPx = hourSlots.length * SCHEDULER_HOUR_COL_PX
  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const eventsByTech = useMemo(() => {
    const map = new Map<string, SchedulerEvent[]>()
    for (const tech of assignableTechs) {
      if (tech.portal_user_id) map.set(tech.portal_user_id, [])
    }
    for (const ev of dayEvents) {
      const techId = ev.assigned_tech_id?.trim()
      if (!techId || !map.has(techId)) continue
      map.get(techId)!.push(ev)
    }
    return map
  }, [assignableTechs, dayEvents])

  const [dragOverCell, setDragOverCell] = useState<{ techId: string; hour: number } | null>(null)

  if (assignableTechs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <User className="h-8 w-8 text-zinc-600" aria-hidden />
        <p className="text-sm text-zinc-400">Add active technicians in Team to use the swimlane board.</p>
        <p className="max-w-sm text-xs text-zinc-500">
          Drag jobs from the pool above onto a technician column to assign and schedule in one step.
        </p>
      </div>
    )
  }

  return (
    <>
      <MobileTimelineBoard
        assignableTechs={assignableTechs}
        eventsByTech={eventsByTech}
        hourSlots={hourSlots}
        timelineWidthPx={timelineWidthPx}
        highlightId={highlightId}
        loading={loading}
        dragOverCell={dragOverCell}
        setDragOverCell={setDragOverCell}
        onSelectEvent={onSelectEvent}
        onDropPoolJob={onDropPoolJob}
        onBookEmptySlot={onBookEmptySlot}
      />

      <div className="hidden max-h-[min(720px,70vh)] flex-1 overflow-auto md:block">
        <div className="flex min-h-0 min-w-max">
          <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border/40 bg-card">
            <div className="h-16 border-b border-border/40" aria-hidden />
            {hourSlots.map((hour) => (
              <div
                key={hour}
                className="flex items-start justify-end border-b border-border/30 pr-2 pt-1 text-[10px] font-medium text-zinc-500"
                style={{ height: SCHEDULER_HOUR_ROW_PX }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {assignableTechs.map((tech) => {
            const techUserId = tech.portal_user_id!
            const laneEvents = eventsByTech.get(techUserId) ?? []

            return (
              <div
                key={tech.id}
                className="w-[min(220px,28vw)] shrink-0 border-r border-border/40 last:border-r-0"
              >
                <div className="sticky top-0 z-10 flex h-16 flex-col justify-center border-b border-border/40 bg-card/95 px-3 backdrop-blur-sm">
                  <p className="truncate text-sm font-semibold text-foreground">{tech.name}</p>
                  <p className="truncate text-[10px] text-zinc-500">
                    {laneEvents.length} job{laneEvents.length === 1 ? "" : "s"} today
                  </p>
                </div>

                <div className="relative bg-muted/10" style={{ height: gridHeightPx }}>
                  {hourSlots.map((hour) => {
                    const isOver = dragOverCell?.techId === techUserId && dragOverCell.hour === hour
                    return (
                      <button
                        key={hour}
                        type="button"
                        aria-label={`Assign job to ${tech.name} at ${formatHourLabel(hour)}`}
                        className={cn(
                          "absolute left-0 right-0 border-b border-border/20 bg-transparent transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          isOver && "bg-primary/15 ring-2 ring-inset ring-primary/50"
                        )}
                        style={{
                          top: (hour - SCHEDULER_GRID_START_HOUR) * SCHEDULER_HOUR_ROW_PX,
                          height: SCHEDULER_HOUR_ROW_PX,
                        }}
                        onClick={() => onBookEmptySlot?.(techUserId, hour)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = "move"
                          setDragOverCell({ techId: techUserId, hour })
                        }}
                        onDragLeave={() => {
                          setDragOverCell((cell) =>
                            cell?.techId === techUserId && cell.hour === hour ? null : cell
                          )
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverCell(null)
                          const jobId = e.dataTransfer.getData(HOPPER_DRAG_MIME)
                          if (!jobId) return
                          onDropPoolJob?.(jobId, techUserId, hour)
                        }}
                      />
                    )
                  })}

                  {laneEvents.map((ev) => (
                    <SwimlaneAppointmentBlock
                      key={ev.id}
                      ev={ev}
                      highlighted={highlightId === ev.id}
                      onSelect={() => onSelectEvent?.(ev)}
                    />
                  ))}

                  {laneEvents.length === 0 && !loading ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
                      <p className="text-center text-[10px] text-zinc-600">Drop a pool job here</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 border-t border-border/40 py-3 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading schedule…
          </div>
        ) : null}
      </div>
    </>
  )
}
