"use client"

import { useCallback, useState } from "react"
import { Loader2, Phone, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { resolveJobScheduledAtIso } from "@/lib/scheduler-appointment-interaction"
import { useScheduleInteractionPhase } from "@/components/scheduler/schedule-interaction-badge"
import {
  JOB_PIPELINE_STATUS_OPTIONS,
  PIPELINE_STATUS_BADGE_STYLE,
  pipelineStatusPillLabel,
  type JobPipelineStatusId,
} from "@/lib/job-pipeline-status"
import {
  formatScheduledDateDisplay,
  formatScheduledTimeDisplay,
} from "@/lib/scheduler-utils"
import {
  buildDepositSmsStagingTemplate,
  createMockSecureDepositLink,
} from "@/lib/secure-deposit-link"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INPUT,
  SCHEDULER_METADATA_LABEL,
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
  /** Persisted booking balance in dollars — from API / DB only. */
  billingBalanceDollars: number
  jobNotes: string
  pipelineStatus: JobPipelineStatusId
  assignedTechId: string
  pipelineDirty: boolean
  saving: boolean
  hydrating?: boolean
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

const SECTION_LABEL =
  "text-[10px] uppercase font-bold tracking-widest text-slate-500"

const ACTION_BTN =
  "flex min-h-[44px] items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50"

export function JobDetailOverview({
  source,
  scheduledEvent,
  technicians,
  activePipelineJobs = [],
  billingBalanceDollars,
  jobNotes,
  pipelineStatus,
  assignedTechId,
  pipelineDirty,
  saving,
  hydrating = false,
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
  const vehicleBlock = specBlocks.find((block) => block.label === "Vehicle")
  const addressBlock = specBlocks.find((block) => block.label === "Address")
  const keyBlocks = specBlocks.filter(
    (block) =>
      block.label === "Key" ||
      block.label === "TI SKU" ||
      block.label === "FCC ID" ||
      block.label === "Chip" ||
      block.label === "Frequency" ||
      block.label === "Programming" ||
      block.label === "Service"
  )
  const scheduledAtIso = resolveJobScheduledAtIso(
    scheduledEvent ?? { scheduled_at: source.scheduled_at ?? null }
  )
  const jobStatus = scheduledEvent?.job_status ?? null
  const scheduledDateLabel = formatScheduledDateDisplay(scheduledAtIso)
  const scheduledTimeLabel = formatScheduledTimeDisplay(scheduledAtIso)
  const appointmentPhase = useScheduleInteractionPhase({
    scheduled_at: scheduledAtIso,
    job_status: jobStatus,
  })
  const appointmentDelayed = appointmentPhase === "overdue"
  const statusPill = pipelineStatusPillLabel(pipelineStatus)

  const [depositSmsStaging, setDepositSmsStaging] = useState<string | null>(null)

  const handleSecureDepositLink = useCallback(() => {
    const depositUrl = createMockSecureDepositLink(source.id)
    const amountLabel =
      billingBalanceDollars > 0
        ? `$${Math.max(25, Math.round(billingBalanceDollars * 0.2))}`
        : null
    setDepositSmsStaging(
      buildDepositSmsStagingTemplate({
        customerName,
        depositUrl,
        amountLabel,
      })
    )
  }, [source.id, billingBalanceDollars, customerName])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* TOP ROW HEADER */}
      <header className="relative shrink-0 border-b border-border/50 px-5 py-4 pr-14">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground">
            {customerName}
          </h2>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              PIPELINE_STATUS_BADGE_STYLE[pipelineStatus]
            )}
          >
            {statusPill}
          </span>
          {hydrating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading job" />
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            Edit Job Details
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-mono text-sm text-muted-foreground">
            {customerPhone ? formatPhoneDisplay(customerPhone) : "No phone on file"}
          </p>
          {phoneHref ? (
            <Button asChild size="sm" variant="secondary" className="h-8 gap-1.5">
              <a href={phoneHref}>
                <Phone className="h-3.5 w-3.5" aria-hidden />
                Call
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4", SCHEDULER_STACK)}>
        {/* PRICE HIGHLIGHT — DB billing balance only */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent px-4 py-3">
          <p className={cn(SECTION_LABEL, "text-emerald-500/80")}>Billing balance</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-emerald-300">
            {billingBalanceDollars > 0 ? `$${billingBalanceDollars}` : "—"}
          </p>
        </div>

        {/* SECTION A — Vehicle & key */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-3")}>
          <p className={SECTION_LABEL}>Vehicle &amp; key specifics</p>
          {vehicleBlock ? (
            <p className="text-base font-semibold text-foreground">{vehicleBlock.value}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No vehicle on file yet.</p>
          )}
          {keyBlocks.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {keyBlocks.map((block) => (
                <div
                  key={`${block.label}-${block.value}`}
                  className="rounded-xl border border-border/50 bg-slate-950/40 px-3 py-2"
                >
                  <p className={SCHEDULER_METADATA_LABEL}>{block.label}</p>
                  <p
                    className={cn(
                      "mt-0.5 truncate text-sm font-medium text-slate-100",
                      block.label === "TI SKU" && "font-mono text-emerald-300"
                    )}
                  >
                    {block.value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-800 px-3 py-3 text-center text-xs text-slate-500">
              No TI SKU / key specs yet — use Edit Job Details to add them.
            </p>
          )}
          {addressBlock ? (
            <div className="rounded-xl border border-border/40 bg-slate-950/30 px-3 py-2">
              <p className={SCHEDULER_METADATA_LABEL}>Address</p>
              <p className="mt-0.5 text-sm text-slate-200">{addressBlock.value}</p>
            </div>
          ) : null}
        </section>

        {/* Appointment + pipeline status */}
        <section className={cn(SCHEDULER_GLASS_CARD, SCHEDULER_STACK)}>
          <div className={SCHEDULER_FIELD_STACK}>
            <span className={SECTION_LABEL}>Appointment</span>
            <span
              className={cn(
                "text-sm font-medium",
                appointmentDelayed ? "text-rose-400" : "text-slate-200"
              )}
            >
              {scheduledAtIso ? `${scheduledDateLabel} at ${scheduledTimeLabel}` : "Not scheduled yet"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={SCHEDULER_FIELD_STACK}>
              <label htmlFor="job-pipeline-status" className={SECTION_LABEL}>
                Pipeline status
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
              <label htmlFor="job-pipeline-tech" className={SECTION_LABEL}>
                Tech assignment
              </label>
              <TechAssignmentSelect
                technicians={technicians}
                value={assignedTechId}
                disabled={saving || pipelineStatus !== "DISPATCHED"}
                job={source as UnassignedPoolJob | ActivePipelineJob}
                activePipelineJobs={activePipelineJobs}
                onChange={onAssignedTechChange}
              />
            </div>
          </div>
        </section>

        {/* SECTION B — Action center */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-3")}>
          <div className="flex items-center justify-between gap-2">
            <p className={SECTION_LABEL}>Action center</p>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onQuickLifecycleAction("cancelled")}
              className={cn(
                ACTION_BTN,
                "border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onQuickLifecycleAction("referred")}
              className={cn(
                ACTION_BTN,
                "border-violet-500/40 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
              )}
            >
              Mark Referred
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onQuickLifecycleAction("completed")}
              className={cn(
                ACTION_BTN,
                "border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
              )}
            >
              Complete
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSecureDepositLink}
              className={cn(
                ACTION_BTN,
                "border-sky-500/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
              )}
            >
              Secure Deposit Link
            </button>
          </div>
          {depositSmsStaging != null ? (
            <div className="space-y-1.5">
              <label htmlFor="deposit-sms-staging" className={SECTION_LABEL}>
                Deposit SMS staging
              </label>
              <textarea
                id="deposit-sms-staging"
                rows={3}
                value={depositSmsStaging}
                onChange={(e) => setDepositSmsStaging(e.target.value)}
                className="h-20 w-full resize-y rounded-xl border border-sky-900/40 bg-slate-950/60 p-3 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none"
                placeholder="Edit the deposit SMS before sending…"
              />
            </div>
          ) : null}
        </section>

        {/* SECTION C — Internal dispatch notes (chat-like) */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-2")}>
          <label htmlFor="internal-dispatch-notes" className={SECTION_LABEL}>
            Internal dispatch notes
          </label>
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-1 shadow-inner">
            <textarea
              id="internal-dispatch-notes"
              rows={4}
              disabled={saving}
              value={jobNotes}
              placeholder="Add a dispatch note… e.g. Autel failed due to poor cell signal"
              onChange={(e) => onJobNotesChange(e.target.value)}
              onBlur={() => onSaveJobNotes()}
              className="min-h-[96px] w-full resize-y rounded-xl bg-transparent px-3 py-2.5 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
            />
          </div>
        </section>

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      </div>

      <footer className="mb-6 shrink-0 space-y-2 border-t border-border/50 bg-card/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur">
        {pipelineDirty ? (
          <Button type="button" className="w-full" disabled={saving} onClick={onSavePipeline}>
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
        <Button type="button" variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </footer>
    </div>
  )
}
