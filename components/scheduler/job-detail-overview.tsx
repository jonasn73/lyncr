"use client"

import { Loader2, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"
import { cn } from "@/lib/utils"
import type { FieldTechnician, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"
import {
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"

type JobDetailOverviewProps = {
  source: UnassignedPoolJob | SchedulerEvent
  scheduledEvent: SchedulerEvent | null
  poolJob: UnassignedPoolJob | null
  technicians: FieldTechnician[]
  quotedPriceDollars: number
  baselineQuotedDollars: number | null
  discountLabel: string | null
  assignedTechId: string
  statusUpdating: boolean
  assigningTechId: string | null
  onEdit: () => void
  onAssignTech: (techUserId: string) => void
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
  poolJob,
  technicians,
  quotedPriceDollars,
  baselineQuotedDollars,
  discountLabel,
  assignedTechId,
  statusUpdating,
  assigningTechId,
  onEdit,
  onAssignTech,
  onClose,
}: JobDetailOverviewProps) {
  const poolWithTech = poolJob as (UnassignedPoolJob & {
    job_status?: string | null
    assigned_tech_id?: string | null
  }) | null

  const lifecyclePhase = schedulerLifecyclePhase({
    job_status: scheduledEvent?.job_status ?? poolWithTech?.job_status ?? null,
    dispatch_status: scheduledEvent?.dispatch_status ?? poolJob?.dispatch_status ?? null,
    assigned_tech_id:
      scheduledEvent?.assigned_tech_id ?? poolWithTech?.assigned_tech_id ?? (assignedTechId || null),
  })
  const statusLabel = SCHEDULER_STATUS_LABEL[lifecyclePhase]

  const customerName = (source.customer_name ?? "").trim() || "Customer"
  const customerPhone = (source.customer_phone ?? "").trim()
  const phoneHref = telHref(customerPhone)
  const specBlocks = buildJobTechnicalSpecBlocks(source)
  const assignableTechs = technicians.filter((tech) => tech.is_active && tech.portal_user_id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative shrink-0 border-b border-border/60 px-5 py-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Active job</p>
            <span
              className={cn(
                "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                lifecyclePhase === "unassigned" && "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
                lifecyclePhase === "scheduled" && "bg-teal-500/20 text-teal-100 ring-1 ring-teal-500/30",
                lifecyclePhase === "en_route" && "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/30",
                lifecyclePhase === "on_site" && "bg-yellow-500/20 text-yellow-100 ring-1 ring-yellow-500/30",
                lifecyclePhase === "completed" && "bg-zinc-600/30 text-zinc-400 ring-1 ring-zinc-600/40"
              )}
            >
              {statusLabel}
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
          {specBlocks.length > 0 ? (
            specBlocks.map((block) => (
              <div
                key={`${block.label}-${block.value}`}
                className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{block.label}</p>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground">{block.value}</p>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
              No vehicle or key specs saved yet — tap Edit Job Details to add them.
            </p>
          )}
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

        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Route to technician</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={statusUpdating || assigningTechId != null}
              onClick={() => onAssignTech("")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                !assignedTechId
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-foreground"
              )}
            >
              Unassigned
            </button>
            {assignableTechs.map((tech) => {
              const techId = tech.portal_user_id!
              const selected = assignedTechId === techId
              const saving = assigningTechId === techId
              return (
                <button
                  key={techId}
                  type="button"
                  disabled={statusUpdating || (assigningTechId != null && !saving)}
                  onClick={() => onAssignTech(techId)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    selected
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-100"
                      : "border-zinc-700 text-zinc-300 hover:border-sky-500/40 hover:bg-sky-500/10"
                  )}
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  {tech.name}
                </button>
              )
            })}
          </div>
        </div>

        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      </footer>
    </div>
  )
}
