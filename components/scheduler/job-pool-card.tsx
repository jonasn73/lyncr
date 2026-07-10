"use client"

// Draggable card for one unassigned hopper job.

import { useState } from "react"
import { Car, DollarSign, GripVertical, MapPin, Phone, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSchedulerTouchInteraction } from "@/hooks/use-scheduler-mobile-timeline"
import { useLiveClock } from "@/lib/hooks/use-live-clock"
import { resolvePoolJobScheduledTarget } from "@/lib/job-pool-display"
import { ScheduleInteractionBadge } from "@/components/scheduler/schedule-interaction-badge"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import {
  formatPoolJobElapsedAge,
  formatPoolJobPriceLabel,
  formatPoolJobScheduledWindowLabel,
  isPoolJobAsapBooking,
  POOL_JOB_PRIORITY_BADGE_LABEL,
  POOL_JOB_PRIORITY_CARD_CLASS,
  resolvePoolJobBookingPriority,
  resolvePoolJobPostalCode,
  resolvePoolJobServiceLabel,
} from "@/lib/job-pool-display"
import {
  SCHEDULER_BADGE_STYLE,
  SCHEDULER_LIST_CARD_SHELL,
  SCHEDULER_STATUS_LABEL,
} from "@/lib/scheduler-job-status"
import { SCHEDULER_FIELD_STACK, SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"
import { isPriceDeniedRescueJob } from "@/lib/rescue-queue"
import { RescueOfferInline } from "@/components/scheduler/rescue-offer-inline"
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
  const [rescueOfferOpen, setRescueOfferOpen] = useState(false)
  const touchInteraction = useSchedulerTouchInteraction()
  const now = useLiveClock()
  const sidebar = variant === "sidebar"
  const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
  const area = job.neighborhood || job.location
  const region = job.region?.trim() || null
  const postalCode = resolvePoolJobPostalCode(job)
  const priority = resolvePoolJobBookingPriority(job, now)
  const priorityBadge = POOL_JOB_PRIORITY_BADGE_LABEL[priority]
  const scheduledAtIso = resolvePoolJobScheduledTarget(job)
  const isAsap = isPoolJobAsapBooking(job)
  const displayName = job.customer_name?.trim() || job.job_type || "Service call"
  const serviceLabel = resolvePoolJobServiceLabel(job)
  const priceLabel = formatPoolJobPriceLabel(job)
  const programmingMethod = job.programming_method?.trim() || null
  const isRescueJob = isPriceDeniedRescueJob(job)
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
        POOL_JOB_PRIORITY_CARD_CLASS[priority],
        isRescueJob && "ring-1 ring-rose-500/40",
        "group relative touch-manipulation text-left",
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
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 opacity-60 group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
        <div className={cn(SCHEDULER_FIELD_STACK, wrapText ? "w-full flex-1" : "min-w-0 flex-1")}>
          <p
            className={cn(
              "w-full text-sm font-medium text-slate-100",
              wrapText ? "break-words" : "truncate"
            )}
          >
            {displayName}
          </p>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={SCHEDULER_METADATA_LABEL}>{priorityBadge}</span>
              {isRescueJob ? (
                <span className="rounded-full border border-rose-500/60 bg-rose-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-100 shadow-[0_0_10px_rgba(244,63,94,0.25)]">
                  Price Denied
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ScheduleInteractionBadge scheduled_at={scheduledAtIso} />
              {isAsap ? (
                <span
                  className={cn(
                    SCHEDULER_METADATA_LABEL,
                    "shrink-0 tabular-nums text-rose-400"
                  )}
                >
                  {formatPoolJobElapsedAge(job.created_at, now)} ago
                </span>
              ) : (
                <span className={cn(SCHEDULER_METADATA_LABEL, "shrink-0 tabular-nums")}>
                  {formatPoolJobScheduledWindowLabel(job, now)}
                </span>
              )}
            </div>
          </div>
          {isRescueJob ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setRescueOfferOpen((open) => !open)
                }}
                className="text-xs font-bold uppercase tracking-wide text-amber-300 underline decoration-amber-500/60 underline-offset-2 transition-colors hover:text-amber-100"
              >
                Offer Lower Price
              </button>
              {rescueOfferOpen ? (
                <RescueOfferInline job={job} onClose={() => setRescueOfferOpen(false)} />
              ) : null}
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold tabular-nums text-emerald-400">
              <DollarSign className="h-3 w-3 shrink-0" aria-hidden />
              {priceLabel}
            </span>
            <span className={cn(SCHEDULER_METADATA_LABEL, "inline-flex min-w-0 items-center gap-1")}>
              <Wrench className="h-3 w-3 shrink-0" aria-hidden />
              <span className={wrapText ? "break-words" : "truncate"}>{serviceLabel}</span>
            </span>
          </div>
          <div className="mt-1.5 w-full space-y-1">
            {vehicle ? (
              <p className="flex w-full items-start gap-1.5">
                <Car className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                <span className={cn(SCHEDULER_METADATA_LABEL, wrapText ? "break-words" : "truncate")}>
                  {vehicle}
                </span>
              </p>
            ) : null}
            {programmingMethod ? (
              <p className="flex w-full items-start gap-1.5">
                <span className={cn(SCHEDULER_METADATA_LABEL, wrapText ? "break-words" : "truncate")}>
                  {programmingMethod}
                </span>
              </p>
            ) : null}
            {job.customer_phone ? (
              <p className={cn("flex w-full items-start gap-1.5", !wrapText && "text-xs text-slate-400")}>
                <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                <span
                  className={cn(
                    sidebar
                      ? "min-w-0 text-[11px] tabular-nums leading-snug text-slate-400"
                      : cn(detailTextClass, !wrapText && "text-xs text-slate-400")
                  )}
                >
                  {formatPhone(job.customer_phone)}
                </span>
              </p>
            ) : null}
            {area || region || postalCode ? (
              <p className={cn("flex w-full items-start gap-1.5", !wrapText && "text-xs text-slate-500")}>
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                <span className={cn(detailTextClass, !wrapText && "text-xs text-slate-500")}>
                  {[area, region && area !== region ? region : null].filter(Boolean).join(", ")}
                  {postalCode ? (
                    <span className="ml-1 text-xs font-medium text-slate-400">{postalCode}</span>
                  ) : null}
                </span>
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
