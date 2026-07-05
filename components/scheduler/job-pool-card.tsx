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
  /** Vertical sidebar list — full width with wrapped text instead of fixed card width. */
  variant?: "default" | "sidebar"
}

export function JobPoolCard({
  job,
  highlighted,
  onSelect,
  onMobileAssign,
  variant = "default",
}: JobPoolCardProps) {
  const touchInteraction = useSchedulerTouchInteraction()
  const sidebar = variant === "sidebar"
  const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
  const area = job.neighborhood || job.location
  const displayName = job.customer_name?.trim() || job.job_type || "Service call"
  const wrapText = touchInteraction || sidebar
  const detailTextClass = wrapText
    ? "w-full text-sm block break-words text-muted-foreground"
    : "truncate"

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
        "group touch-manipulation text-left",
        sidebar
          ? "flex w-full max-w-none shrink-0 cursor-grab flex-col gap-2 px-3 py-3 active:cursor-grabbing"
          : touchInteraction
            ? "min-w-0 w-full max-w-none shrink-0 cursor-pointer px-3 pt-3 pb-9 active:scale-[0.98] md:px-4 md:pt-4 md:pb-10"
            : "min-w-[200px] max-w-[240px] shrink-0 cursor-grab px-3 pt-3 pb-9 active:cursor-grabbing md:px-4 md:pt-4 md:pb-10",
        !sidebar && !touchInteraction && "cursor-grab active:cursor-grabbing",
        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
    >
      <div className={cn("flex w-full items-start gap-1.5", sidebar ? "pr-2" : "pr-16")}>
        {!touchInteraction ? (
          <GripVertical
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600 opacity-60 group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
        <div className={cn(wrapText ? "w-full flex-1" : "min-w-0 flex-1")}>
          <p
            className={cn(
              "w-full text-sm font-medium text-zinc-100",
              wrapText ? "break-words" : "truncate"
            )}
          >
            {displayName}
          </p>
          <div className="mt-1.5 w-full space-y-1">
            {job.customer_phone ? (
              <p className={cn("flex w-full items-start gap-1.5", !wrapText && "text-xs text-zinc-400")}>
                <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span
                  className={cn(
                    sidebar
                      ? "min-w-0 text-[11px] tabular-nums leading-snug text-zinc-400"
                      : cn(detailTextClass, !wrapText && "text-xs text-zinc-400")
                  )}
                >
                  {formatPhone(job.customer_phone)}
                </span>
              </p>
            ) : null}
            {vehicle ? (
              <p className={cn("flex w-full items-start gap-1.5", !wrapText && "text-xs text-zinc-400")}>
                <Car className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span className={cn(detailTextClass, !wrapText && "text-xs text-zinc-400")}>{vehicle}</span>
              </p>
            ) : null}
            {area ? (
              <p className={cn("flex w-full items-start gap-1.5", !wrapText && "text-xs text-zinc-500")}>
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
                <span className={cn(detailTextClass, !wrapText && "text-xs text-zinc-500")}>{area}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          sidebar ? "self-end" : "absolute bottom-2.5 right-2.5",
          SCHEDULER_BADGE_STYLE.unassigned
        )}
      >
        {SCHEDULER_STATUS_LABEL.unassigned}
      </span>
    </button>
  )
}
