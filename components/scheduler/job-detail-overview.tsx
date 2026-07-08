"use client"

import { Loader2, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { resolveJobScheduledAtIso } from "@/lib/scheduler-appointment-interaction"
import { ScheduleInteractionBadge } from "@/components/scheduler/schedule-interaction-badge"
import {
  JOB_PIPELINE_STATUS_OPTIONS,
  PIPELINE_STATUS_BADGE_STYLE,
  pipelineStatusLabel,
  type JobPipelineStatusId,
} from "@/lib/job-pipeline-status"
import {
  formatScheduledDateDisplay,
  formatScheduledTimeDisplay,
} from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type JobDetailOverviewProps = {
  source: UnassignedPoolJob | SchedulerEvent
  scheduledEvent: SchedulerEvent | null
  poolJob: UnassignedPoolJob | null
  technicians: FieldTechnician[]
  quotedPriceDollars: number
  baselineQuotedDollars: number | null
  discountLabel: string | null
  jobNotes: string
  pipelineStatus: JobPipelineStatusId
  assignedTechId: string
  statusUpdating: boolean
  onEdit: () => void
  onPipelineStatusChange: (status: JobPipelineStatusId) => void
  onAssignedTechChange: (techUserId: string) => void
  onClose: () => void
}

function telHref(phone: string): string | null {
  const trimmed = phone.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 10) return null
  if (trimmed.startsWith("+")) return `tel:${trimmed}`
  return `tel:+1${digits.slice(-10)}`
}

export function JobDetailOverview({
  source,
  scheduledEvent,
  technicians,
  quotedPriceDollars,
  baselineQuotedDollars,
  discountLabel,
  jobNotes,
  pipelineStatus,
  assignedTechId,
  statusUpdating,
  onEdit,
  onPipelineStatusChange,
  onAssignedTechChange,
  onClose,
}: JobDetailOverviewProps) {
  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const phoneHref = telHref(customerPhone)
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const addressBlock = specBlocks.find((block) => block.label === "Address")
  const otherSpecBlocks = specBlocks.filter((block) => block.label !== "Address")
  const assignableTechs = technicians.filter((tech) => tech.is_active && tech.portal_user_id)
  const pipelineBadgeStyle = PIPELINE_STATUS_BADGE_STYLE[pipelineStatus]
  const pipelineLabel = pipelineStatusLabel(pipelineStatus)
  const scheduledAtIso = resolveJobScheduledAtIso(
    scheduledEvent ?? { scheduled_at: source.scheduled_at ?? null }
  )
  const jobStatus = scheduledEvent?.job_status ?? null
  const scheduledDateLabel = formatScheduledDateDisplay(scheduledAtIso)
  const scheduledTimeLabel = formatScheduledTimeDisplay(scheduledAtIso)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative shrink-0 border-b border-border/60 px-5 py-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Active job</p>
            <span
              className={cn(
                "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                pipelineBadgeStyle
              )}
            >
              {pipelineLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Edit Job Details
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{customerName}</p>
            <p className="mt-0.5 font-mono text-sm text-muted-foreground">
              {customerPhone ? formatPhoneDisplay(customerPhone) : "No phone on file"}
            </p>
          </div>
          {phoneHref ? (
            <Button asChild size="sm" className="shrink-0 gap-2">
              <a href={phoneHref}>
                <Phone className="h-4 w-4" aria-hidden />
                Call
              </a>
            </Button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2">
          {otherSpecBlocks.length > 0 ? (
            otherSpecBlocks.map((block) => (
              <div
                key={`${block.label}-${block.value}`}
                className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{block.label}</p>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground">{block.value}</p>
              </div>
            ))
          ) : !addressBlock ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
              No vehicle or key specs saved yet — tap Edit Job Details to add them.
            </p>
          ) : null}

          {addressBlock ? (
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{addressBlock.label}</p>
              <p className="mt-1 text-sm font-medium leading-snug text-foreground">{addressBlock.value}</p>
            </div>
          ) : null}

          <div className="mt-4">
            <span className="mb-1 block text-xs uppercase tracking-wider text-slate-500">Notes</span>
            <p className="min-h-[50px] whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-sm text-slate-200">
              {jobNotes.trim() || "No notes added"}
            </p>
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/60 bg-card px-5 py-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">Billing balance</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-400">
            ${quotedPriceDollars > 0 ? quotedPriceDollars : "—"}
          </p>
          {baselineQuotedDollars != null && baselineQuotedDollars !== quotedPriceDollars ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Baseline ${baselineQuotedDollars}
              {discountLabel ? ` · ${discountLabel}` : ""}
            </p>
          ) : null}
        </div>

        <div className="mb-4 mt-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-3">
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wider text-slate-500">Appointment</span>
            <span className="text-sm font-medium text-slate-200">
              {scheduledAtIso ? `${scheduledDateLabel} at ${scheduledTimeLabel}` : "Not scheduled yet"}
            </span>
          </div>
          <ScheduleInteractionBadge scheduled_at={scheduledAtIso} job_status={jobStatus} />
        </div>

        <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Job pipeline control</p>
            {statusUpdating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          <div className="grid gap-3">
            <div>
              <label
                htmlFor="job-pipeline-status"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                Job status
              </label>
              <select
                id="job-pipeline-status"
                disabled={statusUpdating}
                value={pipelineStatus}
                onChange={(e) => onPipelineStatusChange(e.target.value as JobPipelineStatusId)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
              >
                {JOB_PIPELINE_STATUS_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="job-pipeline-tech"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                Tech assignment
              </label>
              <select
                id="job-pipeline-tech"
                disabled={statusUpdating || pipelineStatus !== "DISPATCHED"}
                value={assignedTechId}
                onChange={(e) => onAssignedTechChange(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
              >
                <option value="">Unassigned — select when scheduled</option>
                {assignableTechs.map((tech) => (
                  <option key={tech.portal_user_id} value={tech.portal_user_id!}>
                    {tech.name}
                  </option>
                ))}
              </select>
              {pipelineStatus !== "DISPATCHED" ? (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Set status to Scheduled to assign a technician on the board.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      </footer>
    </div>
  )
}
