"use client"

import { Loader2, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { resolveJobScheduledAtIso } from "@/lib/scheduler-appointment-interaction"
import { ScheduleInteractionBadge } from "@/components/scheduler/schedule-interaction-badge"
import {
  JOB_PIPELINE_STATUS_OPTIONS,
  type JobPipelineStatusId,
} from "@/lib/job-pipeline-status"
import {
  formatScheduledDateDisplay,
  formatScheduledTimeDisplay,
} from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_FIELD_VALUE,
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INPUT,
  SCHEDULER_METADATA_LABEL,
  SCHEDULER_SPEC_TILE,
  SCHEDULER_STACK,
} from "@/lib/scheduler-ui-tokens"
import { TechAssignmentSelect } from "@/components/scheduler/tech-assignment-select"
import type { ActivePipelineJob, FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

/** Terminal lifecycle status written by Quick Actions. */
export type JobLifecycleQuickStatus = "cancelled" | "referred" | "completed"

type JobDetailOverviewProps = {
  source: UnassignedPoolJob | SchedulerEvent
  scheduledEvent: SchedulerEvent | null
  poolJob: UnassignedPoolJob | null
  technicians: FieldTechnician[]
  activePipelineJobs?: ActivePipelineJob[]
  quotedPriceDollars: number
  baselineQuotedDollars: number | null
  discountLabel: string | null
  jobNotes: string
  pipelineStatus: JobPipelineStatusId
  assignedTechId: string
  pipelineDirty: boolean
  saving: boolean
  error?: string | null
  onEdit: () => void
  onPipelineStatusChange: (status: JobPipelineStatusId) => void
  onAssignedTechChange: (techUserId: string) => void
  onSavePipeline: () => void
  onJobNotesChange: (notes: string) => void
  onSaveJobNotes: () => void
  onQuickLifecycleAction: (status: JobLifecycleQuickStatus) => void
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

/** Low-profile micro-button used in the Quick Actions row. */
const QUICK_ACTION_BASE =
  "text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"

export function JobDetailOverview({
  source,
  scheduledEvent,
  technicians,
  activePipelineJobs = [],
  quotedPriceDollars,
  baselineQuotedDollars,
  discountLabel,
  jobNotes,
  pipelineStatus,
  assignedTechId,
  pipelineDirty,
  saving,
  error = null,
  onEdit,
  onPipelineStatusChange,
  onAssignedTechChange,
  onSavePipeline,
  onJobNotesChange,
  onSaveJobNotes,
  onQuickLifecycleAction,
  onClose,
}: JobDetailOverviewProps) {
  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const phoneHref = telHref(customerPhone)
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const addressBlock = specBlocks.find((block) => block.label === "Address")
  const otherSpecBlocks = specBlocks.filter((block) => block.label !== "Address")
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
            <p className={SCHEDULER_METADATA_LABEL}>Active job</p>
            <p className="mt-1 truncate text-lg font-semibold text-foreground">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-[11px] font-semibold text-primary underline-offset-2 transition-all duration-150 hover:text-emerald-300 hover:underline"
          >
            Edit Job Details
          </button>
        </div>
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4", SCHEDULER_STACK)}>
        <div className={cn(SCHEDULER_GLASS_CARD, "flex flex-wrap items-center justify-between gap-3")}>
          <div className={cn(SCHEDULER_FIELD_STACK, "min-w-0")}>
            <p className="font-mono text-sm text-muted-foreground">
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

        <div className={SCHEDULER_STACK}>
          {otherSpecBlocks.length > 0 ? (
            otherSpecBlocks.map((block) => (
              <div key={`${block.label}-${block.value}`} className={SCHEDULER_SPEC_TILE}>
                <p className={SCHEDULER_METADATA_LABEL}>{block.label}</p>
                <p className={cn(SCHEDULER_FIELD_VALUE, "min-w-0 truncate text-right")}>{block.value}</p>
              </div>
            ))
          ) : !addressBlock ? (
            <p className="rounded-xl border border-dashed border-slate-850 px-3 py-4 text-center text-xs text-slate-500">
              No vehicle or key specs saved yet — tap Edit Job Details to add them.
            </p>
          ) : null}

          {addressBlock ? (
            <div className={SCHEDULER_SPEC_TILE}>
              <p className={SCHEDULER_METADATA_LABEL}>{addressBlock.label}</p>
              <p className={cn(SCHEDULER_FIELD_VALUE, "min-w-0 text-right")}>{addressBlock.value}</p>
            </div>
          ) : null}
        </div>
      </div>

      <footer
        className={cn(
          "shrink-0 border-t border-border/60 bg-card px-5 py-4",
          SCHEDULER_STACK,
          // Extra bottom room so Safari’s home-indicator / browser chrome don’t cover Close
          "mb-6 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
        )}
      >
        <div className={cn(SCHEDULER_GLASS_CARD, "border-emerald-500/30 bg-emerald-500/5")}>
          <p className={cn(SCHEDULER_METADATA_LABEL, "text-emerald-400/90")}>Billing balance</p>
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

        <div className={cn(SCHEDULER_GLASS_CARD, "flex items-center justify-between gap-3")}>
          <div className={SCHEDULER_FIELD_STACK}>
            <span className={SCHEDULER_METADATA_LABEL}>Appointment</span>
            <span className="text-sm font-medium text-slate-200">
              {scheduledAtIso ? `${scheduledDateLabel} at ${scheduledTimeLabel}` : "Not scheduled yet"}
            </span>
          </div>
          <ScheduleInteractionBadge scheduled_at={scheduledAtIso} job_status={jobStatus} />
        </div>

        <div className={SCHEDULER_GLASS_CARD}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className={SCHEDULER_METADATA_LABEL}>Job pipeline control</p>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          <div className={SCHEDULER_STACK}>
            <div className={SCHEDULER_FIELD_STACK}>
              <label htmlFor="job-pipeline-status" className={SCHEDULER_METADATA_LABEL}>
                Job status
              </label>
              <select
                id="job-pipeline-status"
                disabled={saving}
                value={pipelineStatus}
                onChange={(e) => onPipelineStatusChange(e.target.value as JobPipelineStatusId)}
                className={cn(SCHEDULER_INPUT, "disabled:opacity-60")}
              >
                {JOB_PIPELINE_STATUS_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={SCHEDULER_FIELD_STACK}>
              <label htmlFor="job-pipeline-tech" className={SCHEDULER_METADATA_LABEL}>
                Tech assignment
              </label>
              <TechAssignmentSelect
                technicians={technicians}
                value={assignedTechId}
                disabled={saving || pipelineStatus !== "DISPATCHED"}
                job={source}
                activePipelineJobs={activePipelineJobs}
                onChange={onAssignedTechChange}
              />
              {pipelineStatus !== "DISPATCHED" ? (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Set status to Scheduled to assign a technician on the board.
                </p>
              ) : null}
            </div>

            {/* Instant close-out / transfer controls for stalled jobs */}
            <div className={SCHEDULER_FIELD_STACK}>
              <p className={SCHEDULER_METADATA_LABEL}>Quick Actions</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onQuickLifecycleAction("cancelled")}
                  className={cn(
                    QUICK_ACTION_BASE,
                    "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                  )}
                >
                  Cancel Job
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onQuickLifecycleAction("referred")}
                  className={cn(
                    QUICK_ACTION_BASE,
                    "border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
                  )}
                >
                  Mark Referred
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onQuickLifecycleAction("completed")}
                  className={cn(
                    QUICK_ACTION_BASE,
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                  )}
                >
                  Complete
                </button>
              </div>
            </div>

            {/* Dispatcher activity log — persists to job_notes on the lead */}
            <div className={SCHEDULER_FIELD_STACK}>
              <label htmlFor="internal-dispatch-notes" className={SCHEDULER_METADATA_LABEL}>
                Internal Dispatch Notes
              </label>
              <textarea
                id="internal-dispatch-notes"
                rows={4}
                disabled={saving}
                value={jobNotes}
                placeholder="e.g. Autel failed due to poor cell signal, customer towing home, referred to partner with Smart Pro"
                onChange={(e) => onJobNotesChange(e.target.value)}
                onBlur={() => onSaveJobNotes()}
                className="min-h-[88px] w-full resize-y bg-slate-950/50 border border-slate-850 rounded-xl p-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-60"
              />
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}

        {pipelineDirty ? (
          <Button
            type="button"
            className="mt-3 w-full"
            disabled={saving}
            onClick={onSavePipeline}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save pipeline changes"
            )}
          </Button>
        ) : null}

        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      </footer>
    </div>
  )
}
