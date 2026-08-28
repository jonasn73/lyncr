"use client"

// Shared job-card glass — same core facts on owner Active Job and tech console.

import { AlertTriangle, ExternalLink, Phone } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  buildJobCardSummary,
  type JobCardSummarySource,
} from "@/lib/job-card-summary"
import { useScheduleInteractionPhase } from "@/components/scheduler/schedule-interaction-badge"
import { cn } from "@/lib/utils"

type JobCardSummaryProps = {
  /** Any job-like row (DispatchJob, SchedulerEvent, pool job). */
  source: JobCardSummarySource
  /** Owner drawer may already resolve balance dollars from the API. */
  billingBalanceDollars?: number
  /** Optional status pill override (e.g. tech mid-optimistic update). */
  statusLabel?: string
  statusBadgeClass?: string
  /** Show the customer name + status row (tech card). Owner drawer has its own header. */
  showHeader?: boolean
  /** Compact Call chip when phone is present. */
  showCallChip?: boolean
  /**
   * Hide Balance in the facts spine when Money rail already shows it
   * (owner JobDetailOverview — avoids Balance twice on one glance).
   */
  hideBalance?: boolean
  /**
   * Hide the gray `summary` echo when vehicle / service / name are already above.
   */
  hideSummaryLine?: boolean
  className?: string
}

/**
 * Flattened Attribute · Detail spine shared by owner JobDetail and tech JobCard.
 * Money rail / Stripe stay owner-only; tech only sees the balance line here.
 */
export function JobCardSummary({
  source,
  billingBalanceDollars,
  statusLabel,
  statusBadgeClass,
  showHeader = false,
  showCallChip = false,
  hideBalance = false,
  hideSummaryLine = false,
  className,
}: JobCardSummaryProps) {
  // Build the shared view-model once so owner + tech never diverge on core fields.
  const model = buildJobCardSummary(source, { billingBalanceDollars })
  const pillLabel = statusLabel ?? model.statusLabel
  const pillClass = statusBadgeClass ?? model.statusBadgeClass
  // Soft overdue tint on the appointment line (same hook as owner drawer).
  const appointmentPhase = useScheduleInteractionPhase({
    scheduled_at: (source.scheduled_at ?? "").trim() || null,
    job_status: source.job_status ?? null,
  })
  const appointmentDelayed = appointmentPhase === "overdue"

  return (
    <div className={cn("min-w-0", className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
            {model.customerName}
          </h2>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-micro font-semibold",
              pillClass
            )}
          >
            {pillLabel}
          </span>
          {model.fieldVerificationRequired ? (
            <span
              title="Verify key style on vehicle before cutting a blank"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : null}
        </div>
      ) : null}

      {showHeader && model.customerPhone ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-mono text-xs text-foreground">
            {formatPhoneDisplay(model.customerPhone)}
          </p>
          {showCallChip && model.phoneHref ? (
            <a
              href={model.phoneHref}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-micro font-semibold text-emerald-100"
            >
              <Phone className="h-3 w-3" aria-hidden />
              Call
            </a>
          ) : null}
        </div>
      ) : null}

      {model.fieldVerificationRequired && showHeader ? (
        <p className="mt-1.5 text-2xs font-medium text-amber-300">
          Field verification required — confirm dashboard / door lock config before programming.
        </p>
      ) : null}

      {/* Same Attribute · Detail rows as owner Active Job overview */}
      <section
        className={cn(
          "space-y-1 text-xs leading-snug text-foreground",
          showHeader && "mt-2.5 border-t border-border/40 pt-3"
        )}
      >
        <p className="min-w-0">
          <span className="font-semibold text-muted-foreground">Vehicle</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium text-foreground">
            {model.vehicleSummary || "No vehicle / service on file yet"}
          </span>
        </p>
        <p className="min-w-0">
          <span className="font-semibold text-muted-foreground">Address</span>
          <span className="text-muted-foreground"> · </span>
          {model.serviceAddress ? (
            <>
              <span className="font-medium text-foreground">{model.serviceAddress}</span>
              {model.mapsUrl ? (
                <a
                  href={model.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1.5 inline-flex items-center gap-0.5 text-2xs font-semibold text-emerald-300/90 underline-offset-2 hover:underline"
                >
                  Maps
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">No address saved</span>
          )}
        </p>
        <p className="min-w-0">
          {!hideBalance ? (
            <>
              <span className="font-semibold text-emerald-500/80">Balance</span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold tabular-nums text-emerald-300">
                {model.billingLabel}
              </span>
              <span className="text-muted-foreground"> · </span>
            </>
          ) : null}
          <span className="font-semibold text-muted-foreground">Appt</span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={cn(
              "font-medium",
              appointmentDelayed ? "text-rose-400" : "text-foreground"
            )}
          >
            {model.appointmentLabel}
          </span>
        </p>
        {model.keyHint !== "None on file" ? (
          <p className="min-w-0">
            <span className="font-semibold text-muted-foreground">Key</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium text-foreground">{model.keyHint}</span>
          </p>
        ) : null}
        {!hideSummaryLine && model.summaryLine ? (
          <p className="line-clamp-2 text-2xs text-muted-foreground">{model.summaryLine}</p>
        ) : null}
      </section>
    </div>
  )
}
