"use client"

import { Check, Clock, Loader2, RefreshCw, XCircle } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/line-display"
import {
  formatSmsSubmissionDate,
  type SmsRegistrationSubmissionSummary,
} from "@/lib/sms-registration-submission-summary"
import { cn } from "@/lib/utils"

type Props = {
  summary: SmsRegistrationSubmissionSummary
  loading?: boolean
  onRefresh?: () => void
  onEdit?: () => void
  variant?: "modal" | "page"
}

const STEPS = [
  { key: "submitted", label: "Form submitted" },
  { key: "review", label: "Carrier review (1–3 days)" },
  { key: "active", label: "Approved & active" },
] as const

function stepState(
  stepKey: (typeof STEPS)[number]["key"],
  stage: SmsRegistrationSubmissionSummary["lifecycle_stage"]
): "done" | "current" | "upcoming" | "failed" {
  if (stage === "rejected") {
    if (stepKey === "submitted") return "done"
    if (stepKey === "review") return "failed"
    return "upcoming"
  }
  if (stage === "approved") return "done"
  if (stepKey === "submitted") return "done"
  if (stepKey === "review") return stage === "carrier_review" ? "current" : "upcoming"
  return "upcoming"
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm text-foreground sm:text-right">{value}</dd>
    </div>
  )
}

export function SmsRegistrationStatusView({ summary, loading, onRefresh, onEdit, variant = "modal" }: Props) {
  const isRejected = summary.lifecycle_stage === "rejected"
  const isApproved = summary.lifecycle_stage === "approved"
  const isReview = summary.lifecycle_stage === "carrier_review"

  const headline = isRejected
    ? "Registration needs attention"
    : isApproved
      ? "SMS registration approved"
      : "Under carrier review"

  const subcopy = isRejected
    ? "Carriers returned this registration for corrections. Review the details below and update your submission."
    : isApproved
      ? "Your business profile is approved. Lead-alert SMS can deliver on your registered line."
      : "Your SMS business registration is with US carriers for review. Alerts unlock after approval — usually 1–3 business days."

  const phoneDisplay = summary.target_phone_line
    ? formatPhoneDisplay(summary.target_phone_line)
    : "No active line on this workspace yet"
  const phoneLine =
    summary.target_line_label && summary.target_phone_line
      ? `${phoneDisplay} · ${summary.target_line_label}`
      : phoneDisplay

  const referenceLabel =
    summary.carrier_reference_kind === "campaign"
      ? "Telnyx campaign ID"
      : summary.carrier_reference_kind === "brand"
        ? "Telnyx brand ID"
        : "Carrier reference ID"

  return (
    <div className={cn("space-y-5", variant === "page" ? "p-0" : "")}>
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border px-4 py-4",
          isRejected
            ? "border-red-500/30 bg-red-500/10"
            : isApproved
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-amber-500/30 bg-amber-500/10"
        )}
      >
        {isRejected ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />
        ) : isApproved ? (
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
        ) : (
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{headline}</p>
          <p className="mt-1 text-sm text-muted-foreground">{subcopy}</p>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              Refresh status
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Carrier lifecycle</p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {STEPS.map((step, index) => {
            const state = stepState(step.key, summary.lifecycle_stage)
            const isLast = index === STEPS.length - 1
            return (
              <div key={step.key} className="flex min-w-0 flex-1 items-start gap-2 sm:flex-col sm:items-center sm:text-center">
                <div className="flex items-center gap-2 sm:flex-col">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      state === "done" && "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
                      state === "current" && "border-amber-500/50 bg-amber-500/15 text-amber-200",
                      state === "failed" && "border-red-500/50 bg-red-500/15 text-red-300",
                      state === "upcoming" && "border-zinc-700 bg-zinc-900 text-zinc-600"
                    )}
                  >
                    {state === "done" ? <Check className="h-4 w-4" aria-hidden /> : state === "failed" ? "!" : index + 1}
                  </span>
                  {!isLast ? (
                    <span
                      className={cn(
                        "hidden h-px flex-1 sm:block sm:h-8 sm:w-px sm:flex-none",
                        state === "done" ? "bg-emerald-500/40" : "bg-zinc-800"
                      )}
                      aria-hidden
                    />
                  ) : null}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium leading-snug",
                    state === "current" && isReview && "text-amber-200",
                    state === "failed" && "text-red-200",
                    state === "done" && "text-emerald-200/90",
                    state === "upcoming" && "text-zinc-500"
                  )}
                >
                  {step.key === "review" && state === "current" ? `⏳ ${step.label}` : step.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Submission summary</p>
        <dl className="mt-4 space-y-3">
          <SummaryRow label="Business profile" value={summary.legal_business_name?.trim() || "—"} />
          {summary.entity_type ? <SummaryRow label="Entity type" value={summary.entity_type} /> : null}
          {summary.business_address ? <SummaryRow label="Service address" value={summary.business_address} /> : null}
          <SummaryRow label="Target phone line" value={phoneLine} />
          <SummaryRow label="Submission date" value={formatSmsSubmissionDate(summary.submission_date)} />
          <SummaryRow
            label={referenceLabel}
            value={summary.carrier_reference_id?.trim() || "Pending — assigned after carrier intake"}
          />
          {summary.registration_status ? (
            <SummaryRow label="Dashboard status" value={summary.registration_status.replace(/_/g, " ")} />
          ) : null}
          {summary.telnyx_status ? (
            <SummaryRow label="Telnyx status" value={summary.telnyx_status.replace(/_/g, " ")} />
          ) : null}
        </dl>
      </div>

      {summary.rejection_reason ? (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Carrier rejection reason</p>
          <p className="mt-2 text-sm leading-relaxed text-red-100/90">{summary.rejection_reason}</p>
        </div>
      ) : null}

      {!isRejected && summary.status_detail && isReview ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400/90">Latest carrier update</p>
          <p className="mt-2 text-sm text-muted-foreground">{summary.status_detail}</p>
        </div>
      ) : null}

      {isRejected && onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex w-full items-center justify-center rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 sm:w-auto sm:px-5"
        >
          Update registration & resubmit
        </button>
      ) : null}
    </div>
  )
}
