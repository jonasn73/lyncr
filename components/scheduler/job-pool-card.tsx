"use client"

// Draggable card for one unassigned hopper job.

import { Car, GripVertical, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import { SCHEDULER_CARD_STYLE, SCHEDULER_STATUS_LABEL } from "@/lib/scheduler-job-status"
import type { UnassignedPoolJob } from "@/lib/types"

export const HOPPER_DRAG_MIME = "application/x-lyncr-job-id"

type JobPoolCardProps = {
  job: UnassignedPoolJob
  highlighted?: boolean
  onSelect?: (job: UnassignedPoolJob) => void
}

export function JobPoolCard({ job, highlighted, onSelect }: JobPoolCardProps) {
  const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
  const area = job.neighborhood || job.location

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(HOPPER_DRAG_MIME, job.id)
        e.dataTransfer.effectAllowed = "move"
      }}
      onClick={() => onSelect?.(job)}
      className={cn(
        "group flex min-w-[200px] max-w-[240px] shrink-0 cursor-grab flex-col gap-1.5 rounded-2xl border bg-card/90 px-3 py-2.5 text-left shadow-sm transition active:cursor-grabbing",
        highlighted
          ? "border-primary ring-2 ring-primary/40"
          : "border-border/60 hover:border-primary/40 hover:bg-card"
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-xs font-semibold text-foreground">
              {job.job_type || "Service call"}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                SCHEDULER_CARD_STYLE.unassigned
              )}
            >
              {SCHEDULER_STATUS_LABEL.unassigned}
            </span>
          </div>
          {vehicle ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-400">
              <Car className="h-3 w-3 shrink-0" aria-hidden />
              {vehicle}
            </p>
          ) : null}
          {area ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-zinc-500">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              {area}
            </p>
          ) : null}
        </div>
      </div>
      <p className="pl-5 text-[10px] text-zinc-600">Drag to tech lane · tap for details</p>
    </button>
  )
}
