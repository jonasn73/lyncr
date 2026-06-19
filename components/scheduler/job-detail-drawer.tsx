"use client"

// Slide-over detail for a pool or scheduled job (phone lookup / tap).

import { Car, Clock, MapPin, Phone, User, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import type { SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type JobDetailDrawerProps = {
  open: boolean
  poolJob: UnassignedPoolJob | null
  scheduledEvent: SchedulerEvent | null
  onClose: () => void
}

function formatPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

export function JobDetailDrawer({ open, poolJob, scheduledEvent, onClose }: JobDetailDrawerProps) {
  if (!open || (!poolJob && !scheduledEvent)) return null

  const isPool = Boolean(poolJob)
  const title = poolJob?.customer_name || scheduledEvent?.customer_name || "Customer"
  const phone = poolJob?.customer_phone || scheduledEvent?.customer_phone || null
  const jobType = poolJob?.job_type || scheduledEvent?.job_type || null
  const location = poolJob?.location || scheduledEvent?.location || null
  const vehicle = poolJob
    ? vehicleLabelFromParts(poolJob.vehicle_year, poolJob.vehicle_make, poolJob.vehicle_model)
    : scheduledEvent
      ? vehicleLabelFromParts(
          scheduledEvent.vehicle_year,
          scheduledEvent.vehicle_make,
          scheduledEvent.vehicle_model
        )
      : null
  const notes = poolJob?.job_notes || scheduledEvent?.job_notes || null
  const tech = scheduledEvent?.assigned_tech_name || null

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/50" role="presentation" onClick={onClose}>
      <aside
        className={cn(
          "flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl",
          "animate-in slide-in-from-right duration-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {isPool ? "Unassigned pool" : "Scheduled"}
            </p>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-2 text-zinc-500 hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phone ? (
            <p className="flex items-center gap-2 text-zinc-300">
              <Phone className="h-4 w-4 shrink-0 text-zinc-500" />
              {formatPhone(phone)}
            </p>
          ) : null}
          {jobType ? <p className="text-foreground">{jobType}</p> : null}
          {vehicle ? (
            <p className="flex items-center gap-2 text-zinc-400">
              <Car className="h-4 w-4 shrink-0" />
              {vehicle}
            </p>
          ) : null}
          {location ? (
            <p className="flex items-start gap-2 text-zinc-400">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              {location}
            </p>
          ) : null}
          {scheduledEvent ? (
            <p className="flex items-center gap-2 text-zinc-400">
              <Clock className="h-4 w-4 shrink-0" />
              {new Date(scheduledEvent.scheduled_at).toLocaleString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          ) : null}
          {tech ? (
            <p className="flex items-center gap-2 text-zinc-400">
              <User className="h-4 w-4 shrink-0" />
              {tech}
            </p>
          ) : null}
          {notes ? <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-zinc-400">{notes}</p> : null}
        </div>
      </aside>
    </div>
  )
}
