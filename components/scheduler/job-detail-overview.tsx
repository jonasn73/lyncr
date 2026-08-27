"use client"

import { useCallback, useState } from "react"
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessageSquare,
  Pencil,
  Phone,
  Share2,
  Star,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { resolveJobScheduledAtIso } from "@/lib/scheduler-appointment-interaction"
import {
  JOB_PIPELINE_STATUS_OPTIONS,
  type JobPipelineStatusId,
} from "@/lib/job-pipeline-status"
import {
  OPERATOR_JOB_PHASE_BADGE_STYLE,
  OPERATOR_JOB_PHASE_LABEL,
  resolveOperatorJobPhase,
} from "@/lib/scheduler-job-status"
import { jobCardTelHref } from "@/lib/job-card-summary"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_INPUT,
  SCHEDULER_METADATA_LABEL,
} from "@/lib/scheduler-ui-tokens"
import { TechAssignmentSelect } from "@/components/scheduler/tech-assignment-select"
import { JobMoneyRail } from "@/components/scheduler/job-money-rail"
import { JobCardSummary } from "@/components/jobs/job-card-summary"
import { CustomerSmsComposer } from "@/components/messaging/customer-sms-composer"
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
  /** Send Thanks + review SMS (works after Complete, or anytime phone is on file). */
  onSendReviewSms: () => void
  /** Last send attempt failed — button shows Retry. */
  reviewSmsFailed?: boolean
  /** Open Collect / pay modal for this job (card, tap, pay link, receipt). */
  onCollectPayment: () => void
}

const SECTION_LABEL =
  "text-[10px] uppercase font-bold tracking-widest text-slate-500"

/** Compact Call / SMS chips — shorter than the old full-width stacked buttons. */
const CONTACT_BTN =
  "inline-flex min-h-[34px] flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-50"

/** Smaller quick-action cells for the collapsed “More actions” grid. */
const ACTION_BTN =
  "flex min-h-[40px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-[10px] font-semibold leading-tight transition-colors disabled:opacity-50"

/** Accordion toggle row for secondary sections. */
function CollapseToggle({
  open,
  onToggle,
  label,
  hint,
}: {
  open: boolean
  onToggle: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-slate-950/35 px-3 py-2 text-left transition-colors hover:bg-slate-950/55"
    >
      <span className="min-w-0">
        <span className={cn(SECTION_LABEL, "block")}>{label}</span>
        {!open && hint ? (
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{hint}</span>
        ) : null}
      </span>
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform",
          open && "rotate-180"
        )}
        aria-hidden
      />
    </button>
  )
}

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
  onSendReviewSms,
  reviewSmsFailed = false,
  onCollectPayment,
}: JobDetailOverviewProps) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  // Phone = collapse Key details / More actions / Notes by default.
  const isMobile = useIsMobile()
  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const phoneHref = jobCardTelHref(customerPhone)
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const keyBlocks = specBlocks.filter(
    (block) =>
      block.label === "Key" ||
      block.label === "TI SKU" ||
      block.label === "FCC ID" ||
      block.label === "Chip" ||
      block.label === "Programming"
  )
  const scheduledAtIso = resolveJobScheduledAtIso(
    scheduledEvent ?? { scheduled_at: source.scheduled_at ?? null }
  )
  const jobStatus =
    scheduledEvent?.job_status ??
    ("job_status" in source ? (source as SchedulerEvent).job_status : null) ??
    null
  const assignedTechForPhase =
    scheduledEvent?.assigned_tech_id ??
    ("assigned_tech_id" in source
      ? (source as SchedulerEvent).assigned_tech_id
      : null) ??
    assignedTechId ??
    null
  // One human status — job_status terminals win over leftover pool dispatch.
  const operatorPhase = resolveOperatorJobPhase({
    job_status: jobStatus,
    dispatch_status: scheduledEvent?.dispatch_status ?? source.dispatch_status ?? null,
    assigned_tech_id: assignedTechForPhase,
    scheduled_at: scheduledAtIso,
  })
  const statusPill = OPERATOR_JOB_PHASE_LABEL[operatorPhase]
  const isJobDone = operatorPhase === "done"
  // Already cancelled — hide/disable Cancel so it cannot look broken.
  const isJobCancelled = operatorPhase === "cancelled"
  const isJobReferred = operatorPhase === "referred"
  const notesPreview = jobNotes.trim()
    ? jobNotes.trim().replace(/\s+/g, " ")
    : "No notes yet"
  const keyHint =
    keyBlocks.length > 0
      ? keyBlocks.map((b) => b.value).filter(Boolean).slice(0, 2).join(" · ")
      : "None on file"
  // Shared card source — same spine the tech console renders.
  const cardSource = {
    ...source,
    job_status: jobStatus,
    assigned_tech_id: assignedTechForPhase,
    dispatch_status: scheduledEvent?.dispatch_status ?? source.dispatch_status ?? null,
    scheduled_at: scheduledAtIso,
    job_notes: jobNotes,
  }

  // Inline Telnyx SMS composer (popover was z-50 and opened behind this z-[1410] drawer).
  const [smsComposerOpen, setSmsComposerOpen] = useState(false)
  // Secondary sections: collapsed by default on mobile so Dispatch stays above the fold.
  const [keyDetailsOpen, setKeyDetailsOpen] = useState(false)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  const openSmsComposer = useCallback(() => {
    if (!customerPhone) {
      toast({
        title: "No phone on file",
        description: "Add a customer phone before sending SMS.",
        variant: "destructive",
      })
      return
    }
    setSmsComposerOpen((open) => !open)
  }, [customerPhone, toast])

  // Desktop can keep secondary sections open without hurting the fold.
  const showKeyDetails = !isMobile || keyDetailsOpen
  const showMoreActions = !isMobile || moreActionsOpen
  const showNotes = !isMobile || notesOpen

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky header — name, badge, phone, Call/SMS, Edit stay visible while body scrolls */}
      <header className="relative shrink-0 border-b border-border/50 px-4 py-2 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-foreground md:text-lg">
            {customerName}
          </h2>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              OPERATOR_JOB_PHASE_BADGE_STYLE[operatorPhase]
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
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {/* Shorter label on narrow screens */}
            <span className="md:hidden">Edit</span>
            <span className="hidden md:inline">Edit Job Details</span>
          </button>
        </div>

        {/* Phone + Call / SMS on one compact row */}
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">
            {customerPhone ? formatPhoneDisplay(customerPhone) : "No phone on file"}
          </p>
          {phoneHref ? (
            <a
              href={phoneHref}
              className={cn(
                CONTACT_BTN,
                "max-w-[5.5rem] flex-none border-emerald-500/35 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
              )}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={cn(
                CONTACT_BTN,
                "max-w-[5.5rem] flex-none border-slate-800 bg-slate-950/40 text-slate-500"
              )}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call
            </button>
          )}
          <button
            type="button"
            disabled={!customerPhone}
            aria-expanded={smsComposerOpen}
            onClick={openSmsComposer}
            className={cn(
              CONTACT_BTN,
              "max-w-[5.5rem] flex-none",
              smsComposerOpen
                ? "border-sky-400/50 bg-sky-500/20 text-sky-50"
                : "border-sky-500/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            SMS
          </button>
        </div>

        {/* Telnyx SMS composer — lives in the drawer so it is never clipped by z-index */}
        {smsComposerOpen ? (
          <div className="mt-2">
            <CustomerSmsComposer
              toPhone={customerPhone}
              organizationId={activeOrganizationId}
              title="Telnyx SMS"
              showRunningLate
              showQuickTemplates
              onClose={() => setSmsComposerOpen(false)}
              onSent={() => setSmsComposerOpen(false)}
            />
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        {/* Facts spine — balance + gray summary live in Money / above; hide duplicates here */}
        <JobCardSummary
          source={cardSource}
          billingBalanceDollars={billingBalanceDollars}
          hideBalance
          hideSummaryLine
          className="border-b border-border/40 pb-2"
        />

        {/* Money: balance once → Deposit / Collect / Complete / Review */}
        <JobMoneyRail
          jobId={source.id}
          customerName={customerName}
          customerPhone={customerPhone}
          billingBalanceDollars={billingBalanceDollars}
          isJobDone={isJobDone}
          saving={saving}
          reviewSmsFailed={reviewSmsFailed}
          reviewSmsSentAt={
            "review_sms_sent_at" in source
              ? (source as SchedulerEvent).review_sms_sent_at
              : null
          }
          reviewLinkOpenedAt={
            "review_link_opened_at" in source
              ? (source as SchedulerEvent).review_link_opened_at
              : null
          }
          onCollect={onCollectPayment}
          onSendReviewSms={onSendReviewSms}
          onComplete={
            isJobDone ? undefined : () => onQuickLifecycleAction("completed")
          }
        />

        {/* Dispatch — status + tech; assign placeholder explains Scheduled gate */}
        <section className="mt-2 space-y-2 rounded-xl border border-border/50 bg-slate-950/35 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className={SECTION_LABEL}>Dispatch</p>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          <div className={SCHEDULER_FIELD_STACK}>
            <label htmlFor="active-job-pipeline-status" className={SECTION_LABEL}>
              Status
            </label>
            <div className="relative">
              <select
                id="active-job-pipeline-status"
                disabled={saving || pipelineStatus === "completed"}
                value={pipelineStatus}
                onChange={(e) =>
                  onPipelineStatusChange(e.target.value as JobPipelineStatusId)
                }
                className={cn(
                  SCHEDULER_INPUT,
                  "min-h-[40px] w-full appearance-none py-2 pr-9 text-sm font-medium"
                )}
                aria-label="Job pipeline status"
              >
                {/* Same word as header badge — avoid Done vs Completed split */}
                {pipelineStatus === "completed" ? (
                  <option value="completed">Done</option>
                ) : null}
                {JOB_PIPELINE_STATUS_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>

          <div className={SCHEDULER_FIELD_STACK}>
            <div className="flex items-center gap-2">
              <UserRound className="h-3 w-3 text-slate-500" aria-hidden />
              <p className={SECTION_LABEL}>Assign tech</p>
            </div>
            <TechAssignmentSelect
              technicians={technicians}
              value={assignedTechId}
              disabled={saving || pipelineStatus !== "DISPATCHED"}
              job={source as UnassignedPoolJob | ActivePipelineJob}
              activePipelineJobs={activePipelineJobs}
              onChange={onAssignedTechChange}
            />
          </div>

          {pipelineDirty ? (
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={saving}
              onClick={onSavePipeline}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save status & tech"
              )}
            </Button>
          ) : null}
        </section>

        {/* Key specifics — accordion, collapsed by default on mobile */}
        {keyBlocks.length > 0 ? (
          <section className="mt-2">
            {isMobile ? (
              <CollapseToggle
                open={keyDetailsOpen}
                onToggle={() => setKeyDetailsOpen((v) => !v)}
                label="Key details"
                hint={keyHint}
              />
            ) : (
              <p className={cn(SECTION_LABEL, "mb-1.5")}>Key details</p>
            )}
            {showKeyDetails ? (
              <div
                className={cn(
                  "space-y-1 text-[12px] leading-snug",
                  isMobile && "mt-1.5 rounded-lg border border-border/40 bg-slate-950/30 px-3 py-2"
                )}
              >
                {keyBlocks.map((block) => (
                  <p key={`${block.label}-${block.value}`} className="min-w-0 truncate">
                    <span className={cn(SCHEDULER_METADATA_LABEL, "inline")}>{block.label}</span>
                    <span className="text-slate-600"> · </span>
                    <span
                      className={cn(
                        "font-medium text-slate-100",
                        block.label === "TI SKU" && "font-mono text-emerald-300"
                      )}
                    >
                      {block.value}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* More actions — Cancel / Referred / Complete / Review; collapsed on mobile */}
        <section className="mt-2">
          {isMobile ? (
            <CollapseToggle
              open={moreActionsOpen}
              onToggle={() => setMoreActionsOpen((v) => !v)}
              label="More actions"
              hint="Cancel · Referred · Complete · Review"
            />
          ) : (
            <p className={cn(SECTION_LABEL, "mb-1.5")}>Quick actions</p>
          )}
          {showMoreActions ? (
            <div className={cn(isMobile && "mt-1.5")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  // Already cancelled → disabled with clear label (not a dead tap).
                  disabled={saving || isJobCancelled}
                  onClick={() => onQuickLifecycleAction("cancelled")}
                  className={cn(
                    ACTION_BTN,
                    isJobCancelled
                      ? "border-zinc-600/40 bg-zinc-800/40 text-zinc-400"
                      : "border-rose-500/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                  )}
                  title={isJobCancelled ? "This job is already cancelled" : "Cancel this job"}
                >
                  <Ban className="h-3.5 w-3.5 opacity-90" aria-hidden />
                  {isJobCancelled ? "Cancelled" : "Cancel"}
                </button>
                <button
                  type="button"
                  disabled={saving || isJobReferred}
                  onClick={() => onQuickLifecycleAction("referred")}
                  className={cn(
                    ACTION_BTN,
                    isJobReferred
                      ? "border-zinc-600/40 bg-zinc-800/40 text-zinc-400"
                      : "border-violet-500/35 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                  )}
                  title={isJobReferred ? "Already marked referred" : "Mark as referred"}
                >
                  <Share2 className="h-3.5 w-3.5 opacity-90" aria-hidden />
                  {isJobReferred ? "Referred ✓" : "Referred"}
                </button>
                <button
                  type="button"
                  disabled={saving || isJobDone}
                  onClick={() => onQuickLifecycleAction("completed")}
                  className={cn(
                    ACTION_BTN,
                    "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                  )}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 opacity-90" aria-hidden />
                  Complete
                </button>
                <button
                  type="button"
                  disabled={saving || !customerPhone}
                  onClick={onSendReviewSms}
                  className={cn(
                    ACTION_BTN,
                    reviewSmsFailed
                      ? "border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                  )}
                >
                  <Star className="h-3.5 w-3.5 opacity-90" aria-hidden />
                  {reviewSmsFailed ? "Retry SMS" : "Review SMS"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* Internal notes — collapsed / one-line preview on mobile */}
        <section className="mt-2">
          {isMobile ? (
            <CollapseToggle
              open={notesOpen}
              onToggle={() => setNotesOpen((v) => !v)}
              label="Notes"
              hint={notesPreview}
            />
          ) : (
            <label htmlFor="internal-dispatch-notes" className={cn(SECTION_LABEL, "mb-1.5 block")}>
              Internal dispatch notes
            </label>
          )}
          {showNotes ? (
            <div
              className={cn(
                "rounded-xl border border-slate-800/80 bg-slate-950/70 p-0.5 shadow-inner",
                isMobile && "mt-1.5"
              )}
            >
              <textarea
                id="internal-dispatch-notes"
                rows={2}
                disabled={saving}
                value={jobNotes}
                placeholder="Add a dispatch note… e.g. Autel failed due to poor cell signal"
                onChange={(e) => onJobNotesChange(e.target.value)}
                onBlur={() => onSaveJobNotes()}
                className="min-h-[56px] w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
              />
            </div>
          ) : null}
        </section>

        {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
      </div>
    </div>
  )
}
