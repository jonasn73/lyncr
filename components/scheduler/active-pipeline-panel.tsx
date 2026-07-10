"use client"

// Group active pipeline jobs by execution phase for the map split-view left panel.

import { useMemo } from "react"
import { Car, Check, Clock, Loader2, MapPin, MapPinned, Pencil, Phone, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTelHref } from "@/lib/phone-e164"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import { useLiveClock } from "@/lib/hooks/use-live-clock"
import {
  formatSchedulerJobCountdown,
  resolveSchedulerJobUrgency,
  SCHEDULER_URGENCY_CARD_BORDER_CLASS,
  SCHEDULER_URGENCY_LABEL,
  SCHEDULER_URGENCY_TIME_CLASS,
} from "@/lib/scheduler-job-urgency"
import {
  PIPELINE_PANEL_GROUP_ORDER,
  PIPELINE_PANEL_GROUP_TITLE,
  SCHEDULER_BADGE_STYLE,
  SCHEDULER_LIST_CARD_SHELL,
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
  type SchedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import {
  SCHEDULER_ACTION_BUTTON,
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INTERACTIVE_TEXT_LINK,
  SCHEDULER_METADATA_LABEL,
} from "@/lib/scheduler-ui-tokens"
import type { ActivePipelineJob } from "@/lib/types"

function formatPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

function formatTime(iso: string | null): string {
  if (!iso) return "Unscheduled"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function jobPhase(job: ActivePipelineJob): SchedulerLifecyclePhase {
  return schedulerLifecyclePhase({
    job_status: job.job_status,
    dispatch_status: job.dispatch_status,
    assigned_tech_id: job.assigned_tech_id,
  })
}

type ActivePipelinePanelProps = {
  jobs: ActivePipelineJob[]
  loading?: boolean
  highlightId?: string | null
  onFocusJob: (job: ActivePipelineJob) => void
  onEditJob: (job: ActivePipelineJob) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
  layout?: "default" | "mobileSheet"
}

export function ActivePipelinePanel({
  jobs,
  loading,
  highlightId,
  onFocusJob,
  onEditJob,
  onMarkComplete,
  completingJobId,
  layout = "default",
}: ActivePipelinePanelProps) {
  const isMobileSheet = layout === "mobileSheet"
  const now = useLiveClock()
  const grouped = useMemo(() => {
    const buckets = new Map<SchedulerLifecyclePhase, ActivePipelineJob[]>()
    for (const phase of PIPELINE_PANEL_GROUP_ORDER) {
      buckets.set(phase, [])
    }
    for (const job of jobs) {
      const phase = jobPhase(job)
      if (phase === "completed" || phase === "unassigned") continue
      buckets.get(phase)?.push(job)
    }
    return PIPELINE_PANEL_GROUP_ORDER.map((phase) => ({
      phase,
      title: PIPELINE_PANEL_GROUP_TITLE[phase],
      jobs: buckets.get(phase) ?? [],
    })).filter((g) => g.jobs.length > 0)
  }, [jobs])

  if (loading) {
    return (
      <p className="p-6 text-center text-sm text-zinc-500">Loading active pipeline…</p>
    )
  }

  if (grouped.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-zinc-500">
        No active jobs for this day — completed stops are hidden from the dispatch board.
      </p>
    )
  }

  return (
    <div className={cn("flex flex-col", isMobileSheet ? "gap-4" : "min-h-0 gap-4 p-4")}>
      {grouped.map((group) => (
        <section key={group.phase} aria-label={group.title} className="shrink-0">
          <h3
            className={cn(
              SCHEDULER_METADATA_LABEL,
              "mb-2 font-bold",
              isMobileSheet ? "text-xs" : "text-[10px]"
            )}
          >
            {group.title}
            <span className="ml-2 font-normal text-slate-600">({group.jobs.length})</span>
          </h3>
          <ul className={cn("flex flex-col", isMobileSheet ? "gap-3" : "gap-2")}>
            {group.jobs.map((job) => {
              const phase = jobPhase(job)
              const urgency = resolveSchedulerJobUrgency({
                now,
                scheduled_at: job.scheduled_at,
                phase,
              })
              const countdown = formatSchedulerJobCountdown(now, job.scheduled_at)
              const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
              const programmingMethod = job.programming_method?.trim() || null
              const highlighted = highlightId === job.id
              const displayName = job.customer_name?.trim() || "Unknown customer"
              const phone = formatPhone(job.customer_phone)
              const telHref = buildTelHref(job.customer_phone)
              const isCompleting = completingJobId === job.id
              const addressLine = job.location?.trim() || job.summary?.trim() || null
              const notesLine = job.job_notes?.trim() || null

              if (isMobileSheet) {
                return (
                  <li key={job.id}>
                    <article
                      className={cn(
                        SCHEDULER_LIST_CARD_SHELL,
                        SCHEDULER_URGENCY_CARD_BORDER_CLASS[urgency],
                        "px-3 py-3 md:px-4 md:py-4",
                        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-semibold leading-tight text-zinc-50">{displayName}</p>
                          {job.job_type ? (
                            <p className="mt-1 text-sm font-medium text-primary">{job.job_type}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label={`Edit job for ${displayName}`}
                          onClick={() => onEditJob(job)}
                          className={cn(
                            SCHEDULER_ACTION_BUTTON,
                            highlighted && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </button>
                      </div>

                      <div className="mt-3 space-y-2.5 text-sm text-slate-300">
                        <p className="flex items-center gap-2">
                          <Phone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                          {telHref ? (
                            <a
                              href={telHref}
                              className={SCHEDULER_INTERACTIVE_TEXT_LINK}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {phone}
                            </a>
                          ) : (
                            <span>{phone}</span>
                          )}
                        </p>
                        <p className="flex items-start gap-2">
                          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                          <span className={cn(SCHEDULER_METADATA_LABEL, SCHEDULER_URGENCY_TIME_CLASS[urgency])}>
                            {formatTime(job.scheduled_at)}
                            {countdown ? ` · ${countdown}` : ""}
                          </span>
                        </p>
                        {vehicle ? (
                          <p className="flex items-center gap-2">
                            <Car className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                            <span className={SCHEDULER_METADATA_LABEL}>{vehicle}</span>
                          </p>
                        ) : null}
                        {programmingMethod ? (
                          <p className={SCHEDULER_METADATA_LABEL}>{programmingMethod}</p>
                        ) : null}
                        {job.assigned_tech_name ? (
                          <p className="flex items-center gap-2">
                            <User className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                            <span>{job.assigned_tech_name}</span>
                          </p>
                        ) : null}
                        <p className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                          {addressLine ? (
                            <span className="break-words text-zinc-100">{addressLine}</span>
                          ) : (
                            <span className="text-zinc-500">No address on file — tap Edit to add one</span>
                          )}
                        </p>
                        {notesLine ? (
                          <p className={cn(SCHEDULER_GLASS_CARD, "px-3 py-2 text-xs leading-relaxed text-slate-400")}>
                            {notesLine}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                            SCHEDULER_BADGE_STYLE[phase]
                          )}
                        >
                          {SCHEDULER_STATUS_LABEL[phase]}
                        </span>
                        <button
                          type="button"
                          onClick={() => onFocusJob(job)}
                          className={SCHEDULER_ACTION_BUTTON}
                        >
                          <MapPinned className="h-3.5 w-3.5" aria-hidden />
                          Map
                        </button>
                        {onMarkComplete ? (
                          <button
                            type="button"
                            disabled={isCompleting}
                            aria-label={`Mark ${displayName} as done`}
                            onClick={() => onMarkComplete(job.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-200"
                          >
                            {isCompleting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Check className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Done
                          </button>
                        ) : null}
                      </div>
                    </article>
                  </li>
                )
              }

              return (
                <li key={job.id}>
                  <div
                    className={cn(
                      SCHEDULER_LIST_CARD_SHELL,
                      SCHEDULER_URGENCY_CARD_BORDER_CLASS[urgency],
                      "group relative w-full text-left",
                      isMobileSheet ? "px-4 py-3" : "px-3 pb-9 pt-3",
                      highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Edit job for ${displayName}`}
                      onClick={() => onEditJob(job)}
                      className={cn(
                        "absolute right-3 top-3 z-20",
                        SCHEDULER_ACTION_BUTTON,
                        "px-2 py-0.5 text-[10px] shadow-sm",
                        highlighted && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      )}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditJob(job)}
                      className="block w-full cursor-pointer text-left"
                    >
                      <div className="flex items-start justify-between gap-2 pr-14">
                        <p
                          className={cn(
                            "font-medium text-zinc-100",
                            isMobileSheet ? "text-base" : "truncate text-sm"
                          )}
                        >
                          {displayName}
                        </p>
                      </div>

                      <div className="mt-2 space-y-1.5">
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                          <span className="truncate">{phone}</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                          <span className={cn(SCHEDULER_METADATA_LABEL, "truncate", SCHEDULER_URGENCY_TIME_CLASS[urgency])}>
                            {formatTime(job.scheduled_at)}
                            {countdown ? ` · ${countdown}` : ""}
                            {job.job_type ? ` · ${job.job_type}` : ""}
                          </span>
                        </p>
                        {urgency !== "later" && urgency !== "unscheduled" ? (
                          <p className={SCHEDULER_METADATA_LABEL}>
                            {SCHEDULER_URGENCY_LABEL[urgency]}
                          </p>
                        ) : null}
                        {vehicle ? (
                          <p className="flex items-center gap-1.5">
                            <Car className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                            <span className={cn(SCHEDULER_METADATA_LABEL, "truncate")}>{vehicle}</span>
                          </p>
                        ) : null}
                        {programmingMethod ? (
                          <p className={cn(SCHEDULER_METADATA_LABEL, "truncate")}>{programmingMethod}</p>
                        ) : null}
                        {job.assigned_tech_name ? (
                          <p className="flex items-center gap-1.5 text-xs text-slate-400">
                            <User className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                            <span className="truncate">{job.assigned_tech_name}</span>
                          </p>
                        ) : null}
                        {job.location ? (
                          <p className="flex items-start gap-1.5 text-xs text-slate-500">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                            <span className={isMobileSheet ? "break-words" : "line-clamp-2"}>{job.location}</span>
                          </p>
                        ) : null}
                      </div>

                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          SCHEDULER_BADGE_STYLE[phase],
                          isMobileSheet ? "mt-3 inline-flex" : "absolute bottom-2.5 right-2.5"
                        )}
                      >
                        {SCHEDULER_STATUS_LABEL[phase]}
                      </span>
                    </button>

                    {onMarkComplete ? (
                      <button
                        type="button"
                        disabled={isCompleting}
                        aria-label={`Mark ${displayName} as done`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMarkComplete(job.id)
                        }}
                        className={cn(
                          "absolute bottom-2.5 left-3 z-20 inline-flex items-center gap-1 rounded-md border border-emerald-600/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/25",
                          isMobileSheet && "static mt-3"
                        )}
                      >
                        {isCompleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden />
                        )}
                        Done
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
