"use client"

// Per-tech schedule board — desktop vertical swimlanes + mobile horizontal timeline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, User, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { HOPPER_DRAG_MIME } from "@/components/scheduler/job-pool-card"
import {
  useSchedulerMobileTimeline,
  useSchedulerTouchInteraction,
} from "@/hooks/use-scheduler-mobile-timeline"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  SCHEDULER_CARD_STYLE,
  SCHEDULER_STATUS_LABEL,
  SCHEDULER_TIMELINE_CARD_HOVER,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { schedulerDispatchCardStyle } from "@/lib/job-pipeline-status"
import { SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"
import {
  SCHEDULER_GRID_END_HOUR,
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
  /** Mobile hopper card tapped — opens the technician assign overlay. */
  mobileAssignRequest?: MobileSchedulerAssignRequest | null
  onMobileAssignRequestClear?: () => void
}

/** Payload when a pool job is queued for mobile tap-to-assign. */
export type MobileSchedulerAssignRequest = {
  jobId: string
  jobLabel: string
}

type MobileAssignOverlayState = {
  hour24: number
  jobId: string | null
  jobLabel: string | null
  /** Tech row the user tapped (pre-selects in the overlay list). */
  suggestedTechUserId: string | null
}

const MOBILE_DOUBLE_TAP_MS = 450

function defaultMobileAssignHour(): number {
  const now = new Date()
  let hour = now.getHours()
  if (now.getMinutes() > 0) hour += 1
  return Math.max(SCHEDULER_GRID_START_HOUR, Math.min(hour, SCHEDULER_GRID_END_HOUR - 1))
}

function MobileTechnicianAssignOverlay({
  open,
  assignableTechs,
  overlay,
  onClose,
  onConfirm,
}: {
  open: boolean
  assignableTechs: FieldTechnician[]
  overlay: MobileAssignOverlayState | null
  onClose: () => void
  onConfirm: (techUserId: string) => void
}) {
  const [selectedTechUserId, setSelectedTechUserId] = useState<string | null>(null)
  const lastTapRef = useRef<{ techUserId: string; at: number } | null>(null)

  useEffect(() => {
    if (!open || !overlay) return
    setSelectedTechUserId(overlay.suggestedTechUserId)
    lastTapRef.current = null
  }, [open, overlay?.hour24, overlay?.jobId, overlay?.suggestedTechUserId])

  const handleTechTap = useCallback(
    (techUserId: string) => {
      const now = Date.now()
      const last = lastTapRef.current
      if (last?.techUserId === techUserId && now - last.at <= MOBILE_DOUBLE_TAP_MS) {
        onConfirm(techUserId)
        lastTapRef.current = null
        return
      }
      lastTapRef.current = { techUserId, at: now }
      setSelectedTechUserId(techUserId)
    },
    [onConfirm]
  )

  const hourLabel = overlay ? formatHourLabel(overlay.hour24) : ""
  const jobLabel = overlay?.jobLabel?.trim()
  const selectedTech = assignableTechs.find((tech) => tech.portal_user_id === selectedTechUserId)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-0 border-zinc-800 bg-zinc-950 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-zinc-800 px-4 py-3 text-left">
          <DialogTitle className="text-base text-zinc-50">
            {overlay?.jobId ? "Assign job" : "Book time slot"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {jobLabel ? (
              <>
                <span className="font-medium text-zinc-200">{jobLabel}</span>
                {" · "}
              </>
            ) : null}
            {hourLabel} · select a technician, then tap Confirm
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[min(50vh,360px)] overflow-y-auto p-3">
          {assignableTechs.map((tech) => {
            const techUserId = tech.portal_user_id!
            const selected = selectedTechUserId === techUserId
            return (
              <li key={tech.id} className="mb-2 last:mb-0">
                <button
                  type="button"
                  onClick={() => handleTechTap(techUserId)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition touch-manipulation",
                    MOBILE_TAP_TARGET,
                    selected
                      ? "border-cyan-500 bg-cyan-950/40 ring-2 ring-cyan-500/30"
                      : "border-zinc-800 bg-zinc-900/80 active:scale-[0.98] active:bg-zinc-800"
                  )}
                  aria-pressed={selected}
                  aria-label={
                    selected
                      ? `${tech.name} selected. Double-tap to assign immediately.`
                      : `Select ${tech.name}`
                  }
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                      selected ? "bg-cyan-500 text-zinc-950" : "bg-zinc-800 text-zinc-200"
                    )}
                    aria-hidden
                  >
                    {tech.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">{tech.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {selected
                        ? "Selected — tap Confirm below or double-tap to assign"
                        : "Tap to select"}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-zinc-800">
          {selectedTech && selectedTechUserId ? (
            <div className="overflow-hidden px-3 pt-3 transition-all duration-200 ease-out animate-in slide-in-from-bottom-2 fade-in">
              <Button
                type="button"
                className="min-h-11 w-full touch-manipulation bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                onClick={() => onConfirm(selectedTechUserId)}
              >
                Confirm Assignment to {selectedTech.name}
              </Button>
            </div>
          ) : null}
          <div className="px-3 py-2">
            <Button type="button" variant="ghost" className="w-full gap-2" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden />
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
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

function formatProgrammingMethod(ev: SchedulerEvent): string | null {
  return ev.programming_method?.trim() || null
}

function eventCardStyle(ev: SchedulerEvent): string {
  const dispatchStyle = schedulerDispatchCardStyle(ev.dispatch_status)
  if (dispatchStyle) return dispatchStyle
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
  const programmingMethod = formatProgrammingMethod(ev)
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
        onSelect ? cn("pointer-events-auto cursor-pointer", SCHEDULER_TIMELINE_CARD_HOVER) : "pointer-events-none",
        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        eventCardStyle(ev)
      )}
      style={{ top: topPx, height: heightPx, minHeight: 36 }}
    >
      <p className="truncate text-[11px] font-semibold">
        {ev.customer_name || "Customer"}
        <span className={cn("ml-1", SCHEDULER_METADATA_LABEL, "normal-case")}>
          · {SCHEDULER_STATUS_LABEL[phase]}
        </span>
      </p>
      <p className={cn("truncate", SCHEDULER_METADATA_LABEL)}>
        {vehicle || ev.job_type || "Appointment"}
      </p>
      {programmingMethod ? (
        <p className={cn("truncate", SCHEDULER_METADATA_LABEL)}>{programmingMethod}</p>
      ) : null}
      <p className={SCHEDULER_METADATA_LABEL}>
        {formatBlockTime(ev.scheduled_at)}
        {ev.duration_minutes ? ` · ${ev.duration_minutes}m` : ""}
        {ev.scheduled_tentative ? " · Tentative" : ""}
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
        SCHEDULER_TIMELINE_CARD_HOVER,
        highlighted && "ring-2 ring-primary",
        eventCardStyle(ev)
      )}
      style={{ left: leftPx, width: widthPx, minWidth: 56 }}
    >
      <p className="truncate text-[10px] font-semibold text-slate-100">{ev.customer_name || "Job"}</p>
      <p className={cn("truncate", SCHEDULER_METADATA_LABEL)}>{SCHEDULER_STATUS_LABEL[phase]}</p>
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
  onSelectEvent,
  onOpenMobileAssign,
}: {
  assignableTechs: FieldTechnician[]
  eventsByTech: Map<string, SchedulerEvent[]>
  hourSlots: number[]
  timelineWidthPx: number
  highlightId?: string | null
  loading?: boolean
  onSelectEvent?: (event: SchedulerEvent) => void
  onOpenMobileAssign: (payload: {
    hour24: number
    suggestedTechUserId: string
    jobId?: string | null
    jobLabel?: string | null
  }) => void
}) {
  const techColWidth = 112

  return (
    <div className="w-full md:hidden">
      <div className="overflow-x-auto overscroll-x-contain whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex min-w-full flex-col" style={{ minWidth: techColWidth + timelineWidthPx }}>
          <div className="flex border-b border-border/40 bg-card/95">
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-border/40 bg-card px-2 py-2"
              style={{ width: techColWidth }}
            >
              <span className={SCHEDULER_METADATA_LABEL}>Tech</span>
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
                    return (
                      <button
                        key={hour}
                        type="button"
                        aria-label={`Assign to ${tech.name} at ${formatHourLabel(hour)}`}
                        className={cn(
                          "absolute top-0 min-h-[44px] border-r border-border/20 transition touch-manipulation active:bg-primary/10"
                        )}
                        style={{
                          left: (hour - SCHEDULER_GRID_START_HOUR) * SCHEDULER_HOUR_COL_PX,
                          width: SCHEDULER_HOUR_COL_PX,
                          height: SCHEDULER_TECH_ROW_PX,
                        }}
                        onClick={() =>
                          onOpenMobileAssign({
                            hour24: hour,
                            suggestedTechUserId: techUserId,
                          })
                        }
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
  mobileAssignRequest,
  onMobileAssignRequestClear,
}: TechnicianSwimlaneBoardProps) {
  const mobileTimeline = useSchedulerMobileTimeline()
  const touchInteraction = useSchedulerTouchInteraction()
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
  const [mobileOverlay, setMobileOverlay] = useState<MobileAssignOverlayState | null>(null)

  const openMobileAssign = useCallback(
    (payload: {
      hour24: number
      suggestedTechUserId: string
      jobId?: string | null
      jobLabel?: string | null
    }) => {
      setMobileOverlay({
        hour24: payload.hour24,
        jobId: payload.jobId ?? mobileAssignRequest?.jobId ?? null,
        jobLabel: payload.jobLabel ?? mobileAssignRequest?.jobLabel ?? null,
        suggestedTechUserId: payload.suggestedTechUserId,
      })
    },
    [mobileAssignRequest]
  )

  useEffect(() => {
    if (!mobileTimeline || !mobileAssignRequest) return
    setMobileOverlay({
      hour24: defaultMobileAssignHour(),
      jobId: mobileAssignRequest.jobId,
      jobLabel: mobileAssignRequest.jobLabel,
      suggestedTechUserId: assignableTechs[0]?.portal_user_id ?? null,
    })
  }, [mobileAssignRequest, mobileTimeline, assignableTechs])

  const closeMobileOverlay = useCallback(() => {
    setMobileOverlay(null)
    onMobileAssignRequestClear?.()
  }, [onMobileAssignRequestClear])

  const confirmMobileAssign = useCallback(
    (techUserId: string) => {
      if (!mobileOverlay) return
      if (mobileOverlay.jobId) {
        onDropPoolJob?.(mobileOverlay.jobId, techUserId, mobileOverlay.hour24)
      } else {
        onBookEmptySlot?.(techUserId, mobileOverlay.hour24)
      }
      closeMobileOverlay()
    },
    [closeMobileOverlay, mobileOverlay, onBookEmptySlot, onDropPoolJob]
  )

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
        onSelectEvent={onSelectEvent}
        onOpenMobileAssign={openMobileAssign}
      />

      <MobileTechnicianAssignOverlay
        open={mobileTimeline && mobileOverlay != null}
        assignableTechs={assignableTechs}
        overlay={mobileOverlay}
        onClose={closeMobileOverlay}
        onConfirm={confirmMobileAssign}
      />

      <div className="hidden w-full flex-1 overflow-auto md:block">
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
                        onDragOver={
                          touchInteraction
                            ? undefined
                            : (e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = "move"
                                setDragOverCell({ techId: techUserId, hour })
                              }
                        }
                        onDragLeave={
                          touchInteraction
                            ? undefined
                            : () => {
                                setDragOverCell((cell) =>
                                  cell?.techId === techUserId && cell.hour === hour ? null : cell
                                )
                              }
                        }
                        onDrop={
                          touchInteraction
                            ? undefined
                            : (e) => {
                                e.preventDefault()
                                setDragOverCell(null)
                                const jobId = e.dataTransfer.getData(HOPPER_DRAG_MIME)
                                if (!jobId) return
                                onDropPoolJob?.(jobId, techUserId, hour)
                              }
                        }
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
