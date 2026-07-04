"use client"

// Draggable card for one unassigned hopper job.

import { Car, GripVertical, MapPin, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSchedulerTouchInteraction } from "@/hooks/use-scheduler-mobile-timeline"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import {
  SCHEDULER_BADGE_STYLE,
  SCHEDULER_LIST_CARD_SHELL,
  SCHEDULER_STATUS_LABEL,
} from "@/lib/scheduler-job-status"
import type { UnassignedPoolJob } from "@/lib/types"

export const HOPPER_DRAG_MIME = "application/x-lyncr-job-id"

function formatPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

type JobPoolCardProps = {
  job: UnassignedPoolJob
  highlighted?: boolean
  onSelect?: (job: UnassignedPoolJob) => void
  /** Mobile tap-to-assign — opens the swimlane technician overlay instead of drag. */
  onMobileAssign?: (job: UnassignedPoolJob) => void
}

export function JobPoolCard({ job, highlighted, onSelect, onMobileAssign }: JobPoolCardProps) {
  const touchInteraction = useSchedulerTouchInteraction()
  const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
  const area = job.neighborhood || job.location
  const displayName = job.customer_name?.trim() || job.job_type || "Service call"

  return (
    <button
      type="button"
      draggable={!touchInteraction}
      onDragStart={
        touchInteraction
          ? undefined
          : (e) => {
              e.dataTransfer.setData(HOPPER_DRAG_MIME, job.id)
              e.dataTransfer.effectAllowed = "move"
            }
      }
      onClick={() => {
        if (touchInteraction && onMobileAssign) {
          onMobileAssign(job)
          return
        }
        onSelect?.(job)
      }}
      className={cn(
        SCHEDULER_LIST_CARD_SHELL,
        "group min-w-[200px] max-w-[240px] shrink-0 touch-manipulation",
        touchInteraction ? "cursor-pointer active:scale-[0.98]" : "cursor-grab active:cursor-grabbing",
        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
    >
      <div className="flex items-start gap-1.5 pr-16">
        {!touchInteraction ? (
          <GripVertical
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600 opacity-60 group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{displayName}</p>
          <div className="mt-1.5 space-y-1">
            {job.customer_phone ? (
              <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span className="truncate">{formatPhone(job.customer_phone)}</span>
              </p>
            ) : null}
            {vehicle ? (
              <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Car className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span className="truncate">{vehicle}</span>
              </p>
            ) : null}
            {area ? (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
                <span className="truncate">{area}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <span
        className={cn(
          "absolute bottom-2.5 right-2.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          SCHEDULER_BADGE_STYLE.unassigned
        )}
      >
        {SCHEDULER_STATUS_LABEL.unassigned}
      </span>
    </button>
  )
}
