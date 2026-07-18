"use client"

import { useCallback, useState } from "react"
import {
  Ban,
  Car,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Share2,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
import { googleMapsSearchUrl } from "@/lib/google-maps-search-url"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_GLASS_CARD,
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

const QUICK_SMS_TEMPLATES = [
  "Stuck on a job, text you right back!",
  "On my way — give me 10 minutes.",
  "Got your call. What's the address?",
  "Tech is en route — please stay near the vehicle.",
] as const

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

const CONTACT_BTN =
  "inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50"

const ACTION_BTN =
  "flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border px-2.5 py-2.5 text-[11px] font-semibold leading-tight transition-colors disabled:opacity-50"

/** Short mobile-friendly labels for the status control (full labels stay in the menu). */
const PIPELINE_STATUS_SHORT: Record<JobPipelineStatusId, string> = {
  unassigned_pool: "Waiting Pool",
  DISPATCHED: "Scheduled",
  awaiting_time: "Needs Follow Up",
  salvage_pending: "Price Denied",
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
  onClose,
}: JobDetailOverviewProps) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const phoneHref = telHref(customerPhone)
  const serviceAddress = (source.location ?? "").trim()
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const vehicleBlock = specBlocks.find((block) => block.label === "Vehicle")
  const serviceBlock = specBlocks.find((block) => block.label === "Service")
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
  const jobStatus = scheduledEvent?.job_status ?? null
  const scheduledDateLabel = formatScheduledDateDisplay(scheduledAtIso)
  const scheduledTimeLabel = formatScheduledTimeDisplay(scheduledAtIso)
  const appointmentPhase = useScheduleInteractionPhase({
    scheduled_at: scheduledAtIso,
    job_status: jobStatus,
  })
  const appointmentDelayed = appointmentPhase === "overdue"
  const statusPill = pipelineStatusPillLabel(pipelineStatus)

  const vehicleSummary = [vehicleBlock?.value, serviceBlock?.value].filter(Boolean).join(" — ")

  const [depositSmsStaging, setDepositSmsStaging] = useState<string | null>(null)
  const [smsOpen, setSmsOpen] = useState(false)
  const [smsSending, setSmsSending] = useState(false)

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

  const sendQuickSms = useCallback(
    async (text: string) => {
      if (!customerPhone) {
        toast({
          title: "No phone on file",
          description: "Add a customer phone before sending SMS.",
          variant: "destructive",
        })
        return
      }
      setSmsSending(true)
      try {
        const res = await fetch("/api/messaging/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: customerPhone,
            text,
            organization_id:
              activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
                ? activeOrganizationId
                : undefined,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast({
            title: "SMS failed",
            description: json.error || "Could not send the quick text.",
            variant: "destructive",
          })
          return
        }
        toast({ title: "SMS sent", description: text })
        setSmsOpen(false)
      } finally {
        setSmsSending(false)
      }
    },
    [activeOrganizationId, customerPhone, toast]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* HEADER — name, status, edit */}
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

        {/* Phone + contact actions */}
        <p className="mt-2 font-mono text-sm text-slate-300">
          {customerPhone ? formatPhoneDisplay(customerPhone) : "No phone on file"}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {phoneHref ? (
            <a href={phoneHref} className={cn(CONTACT_BTN, "border-emerald-500/35 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20")}>
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call Customer
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={cn(CONTACT_BTN, "border-slate-800 bg-slate-950/40 text-slate-500")}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call Customer
            </button>
          )}
          <Popover open={smsOpen} onOpenChange={setSmsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!customerPhone || smsSending}
                className={cn(
                  CONTACT_BTN,
                  "border-sky-500/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                )}
              >
                {smsSending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                )}
                Quick SMS
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 border-slate-800 bg-slate-950 p-2"
              sideOffset={6}
            >
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                One-tap texts via Telnyx
              </p>
              <ul className="flex flex-col gap-1">
                {QUICK_SMS_TEMPLATES.map((template) => (
                  <li key={template}>
                    <button
                      type="button"
                      disabled={smsSending}
                      onClick={() => void sendQuickSms(template)}
                      className="w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                    >
                      {template}
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4 pb-6",
          SCHEDULER_STACK
        )}
      }>
        {/* Vehicle summary subtitle */}
        <section className="flex items-start gap-3 rounded-2xl border border-border/50 bg-slate-950/45 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300">
            <Car className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className={SECTION_LABEL}>Vehicle &amp; service</p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
              {vehicleSummary || "No vehicle / service on file yet"}
            </p>
          </div>
        </section>

        {/* Location + Google Maps */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-3")}>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <p className={SECTION_LABEL}>Location</p>
          </div>
          {serviceAddress ? (
            <>
              <p className="text-sm leading-relaxed text-slate-100">{serviceAddress}</p>
              <a
                href={googleMapsSearchUrl(serviceAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open in Google Maps
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No service address saved — use Edit Job Details to add one.
            </p>
          )}
        </section>

        {/* Billing + Appointment side-by-side */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-3">
            <p className={cn(SECTION_LABEL, "text-emerald-500/80")}>Billing balance</p>
            <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-emerald-300">
              {billingBalanceDollars > 0 ? `$${billingBalanceDollars}` : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-slate-950/40 px-3 py-3">
            <p className={SECTION_LABEL}>Appointment</p>
            <p
              className={cn(
                "mt-1 text-sm font-semibold leading-snug",
                appointmentDelayed ? "text-rose-400" : "text-slate-100"
              )}
            >
              {scheduledAtIso ? (
                <>
                  <span className="block">{scheduledDateLabel}</span>
                  <span className="block text-xs font-medium text-slate-400">{scheduledTimeLabel}</span>
                </>
              ) : (
                "Not scheduled"
              )}
            </p>
          </div>
        </div>

        {/* Key specs (compact) */}
        {keyBlocks.length > 0 ? (
          <section className={cn(SCHEDULER_GLASS_CARD, "space-y-2")}>
            <p className={SECTION_LABEL}>Key specifics</p>
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
          </section>
        ) : null}

        {/* Dispatch controls — status, tech, quick actions */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-4")}>
          <div className="flex items-center justify-between gap-2">
            <p className={SECTION_LABEL}>Dispatch</p>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          {/* Status chips — readable on mobile (no truncated native select) */}
          <div className={SCHEDULER_FIELD_STACK}>
            <p className={SECTION_LABEL}>Status</p>
            <div
              className="grid grid-cols-2 gap-1.5"
              role="radiogroup"
              aria-label="Job pipeline status"
            >
              {JOB_PIPELINE_STATUS_OPTIONS.map((option) => {
                const selected = pipelineStatus === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    disabled={saving}
                    title={option.label}
                    aria-checked={selected}
                    onClick={() => onPipelineStatusChange(option.id)}
                    className={cn(
                      "min-h-[42px] rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold leading-snug transition-colors disabled:opacity-50",
                      selected
                        ? cn(
                            "ring-1",
                            PIPELINE_STATUS_BADGE_STYLE[option.id],
                            "border-transparent"
                          )
                        : "border-border/60 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:bg-slate-900/60"
                    )}
                  >
                    {PIPELINE_STATUS_SHORT[option.id]}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              {JOB_PIPELINE_STATUS_OPTIONS.find((o) => o.id === pipelineStatus)?.label}
            </p>
          </div>

          <div className={SCHEDULER_FIELD_STACK}>
            <div className="flex items-center gap-1.5">
              <UserRound className="h-3 w-3 text-slate-500" aria-hidden />
              <p className={SECTION_LABEL}>Tech assignment</p>
            </div>
            <TechAssignmentSelect
              technicians={technicians}
              value={assignedTechId}
              disabled={saving || pipelineStatus !== "DISPATCHED"}
              job={source as UnassignedPoolJob | ActivePipelineJob}
              activePipelineJobs={activePipelineJobs}
              onChange={onAssignedTechChange}
            />
            {pipelineStatus !== "DISPATCHED" ? (
              <p className="text-[11px] leading-snug text-slate-500">
                Set status to <span className="font-medium text-slate-300">Scheduled</span> to assign
                a tech.
              </p>
            ) : null}
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

          <div className="border-t border-border/40 pt-3">
            <p className={cn(SECTION_LABEL, "mb-2")}>Quick actions</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onQuickLifecycleAction("cancelled")}
                className={cn(
                  ACTION_BTN,
                  "border-rose-500/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                )}
              >
                <Ban className="h-4 w-4 opacity-90" aria-hidden />
                Cancel job
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onQuickLifecycleAction("referred")}
                className={cn(
                  ACTION_BTN,
                  "border-violet-500/35 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                )}
              >
                <Share2 className="h-4 w-4 opacity-90" aria-hidden />
                Mark referred
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onQuickLifecycleAction("completed")}
                className={cn(
                  ACTION_BTN,
                  "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                )}
              >
                <CheckCircle2 className="h-4 w-4 opacity-90" aria-hidden />
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
                <Link2 className="h-4 w-4 opacity-90" aria-hidden />
                Deposit link
              </button>
            </div>
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

        {/* Dispatch notes */}
        <section className={cn(SCHEDULER_GLASS_CARD, "space-y-2")}>
          <label htmlFor="internal-dispatch-notes" className={SECTION_LABEL}>
            Internal dispatch notes
          </label>
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-1 shadow-inner">
            <textarea
              id="internal-dispatch-notes"
              rows={3}
              disabled={saving}
              value={jobNotes}
              placeholder="Add a dispatch note… e.g. Autel failed due to poor cell signal"
              onChange={(e) => onJobNotesChange(e.target.value)}
              onBlur={() => onSaveJobNotes()}
              className="min-h-[80px] w-full resize-y rounded-xl bg-transparent px-3 py-2.5 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
            />
          </div>
        </section>

        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        {/* Spacer so the sticky Close footer never covers the last controls */}
        <div className="h-2 shrink-0" aria-hidden />
      </div>

      <footer className="shrink-0 space-y-2 border-t border-border/50 bg-card/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur">
        <Button type="button" variant="outline" className="h-11 w-full" onClick={onClose}>
          Close
        </Button>
      </footer>
    </div>
  )
}
