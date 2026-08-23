"use client"

// Answered-call intake sheet — opens on `call-initiated` (ringing) via Pusher, then upgrades on `call-answered`.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { Loader2, ChevronDown, MapPin, Phone } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { JobAddressAutocomplete, type JobAddressAutocompleteHandle } from "@/components/job-address-autocomplete"
import { VehicleIntakeClarificationsPanel } from "@/components/vehicle-intake-clarifications-panel"
import { VehicleKeyInfoPanel, type VehicleKeySelection, type PreloadedVehicleKeyBundle } from "@/components/vehicle-key-info-panel"
import { OutOfStockFallbackCard } from "@/components/dashboard/out-of-stock-fallback-card"
import { CallTimeInventoryIntake } from "@/components/dashboard/call-time-inventory-intake"
import {
  shouldShowOutOfStockFallback,
  type KeyInventoryApiRow,
} from "@/lib/key-inventory-shared"
import { ServiceQuoteCalculatorPanel } from "@/components/dashboard/service-quote-calculator-panel"
import {
  IntakeJobPhotosPanel,
  type IntakeJobPhoto,
  type IntakeRescueMeta,
} from "@/components/dashboard/intake-job-photos-panel"
import { IncomingCallOpsToolbar, RepeatCallerUrgencyBadge } from "@/components/dashboard/incoming-call-ops-toolbar"
import { MissedCallQuickLogPanel } from "@/components/dashboard/missed-call-quick-log-panel"
import { AppointmentConfirmSmsPanel } from "@/components/messaging/appointment-confirm-sms-panel"
import { SendBookLinkSheet } from "@/components/activity/send-book-link-sheet"
import { IntakePipTray } from "@/components/dashboard/intake-pip-tray"
import { IntakeSchedulePreferenceFields } from "@/components/dashboard/intake-schedule-preference-fields"
import {
  SecondaryCallInterceptBanner,
  type SecondaryIncomingLeg,
} from "@/components/dashboard/secondary-call-intercept-banner"
import { FAILURE_REASON_NEUTRAL } from "@/components/dashboard/price-shopper-recovery-panel"
import { IntakeTravelPreview } from "@/components/dashboard/intake-travel-preview"
import { NearestTechDispatchBadge } from "@/components/dashboard/nearest-tech-dispatch-badge"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { WS_SECTION } from "@/lib/workspace-ui-tokens"
import {
  useInboundCallPanel,
} from "@/lib/inbound-call-panel-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useActiveCallForm,
  type ActiveCallRow,
  type ManualCallStatus,
} from "@/lib/hooks/use-active-call-form"
import {
  manualIntakeStepAfterService,
  PRIMARY_JOB_TYPE_IDS,
  SECONDARY_JOB_TYPE_IDS,
  serviceNeedsJobTypeStep,
} from "@/lib/service-sector-routing"
import { serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import {
  formatQuoteDollars,
  SERVICE_QUOTE_TYPES,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
import {
  LYNCR_FOCUS_INTAKE_EVENT,
  type LyncFocusIntakeDetail,
} from "@/lib/lync-engine-bus"
import { useLyncEngineOptional } from "@/lib/lync-engine-context"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
  OwnerCallRecordingReadyPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  isMissedCallTelemetry,
  normalizeCallEventPhoneDigits,
  shouldOpenOwnerAnsweredIntake,
  shouldOpenOwnerRingingIntake,
  talkSecondsFromCompletedPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  isRingingOnlyIntakeRow,
  openIntakeMatchesCallLeg,
  shouldAutoDismissIntakeOnCallCompleted,
  shouldDismissOpenRingingIntakeForAutomation,
  shouldDismissRingingIntakeAfterPollMiss,
} from "@/lib/owner-ringing-intake-lifecycle"
import {
  intakeCallHeaderLabel,
  resolveIntakeCallLinePhase,
} from "@/lib/intake-call-line-phase"
import {
  consumePendingReturnToIntake,
  emitFocusDispatchMap,
  LYNCR_RETURN_TO_INTAKE_EVENT,
} from "@/lib/dispatch-map-focus"
import type { PageId } from "@/components/app-shell"
import { useToast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { useRepeatCallerUrgency } from "@/lib/hooks/use-repeat-caller-urgency"
import { formatRepeatCallerHistoryLine } from "@/lib/repeat-caller-urgency"
import { buildCrmReturnUrl, buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import {
  continueOpenQuoteStep,
  formatReturningCallerHistoryDate,
  formatReturningCallerHistoryLine,
  formatReturningCallerVehicleFact,
  hasContinueableOpenLead,
  isKnownReturningCaller,
  pickReturningCallerLastJob,
  resolveOpenQuoteYmm,
  resolveRestoredDraftServiceTypeId,
  resumeDraftIntakeStep,
  summarizeReturningCallerNotes,
} from "@/lib/callback-intake-chooser"
import { revalidateSchedulerJobPoolCaches } from "@/lib/hooks/use-job-pool-query"
import {
  loadAnsweredIntakeDismissed,
  markAnsweredIntakeDismissed,
  subscribeAnsweredIntakeDismissed,
} from "@/lib/answered-call-intake-dismiss"
import { isFlatAddressReadyForDispatch } from "@/lib/intake-address-helpers"
import {
  formatIntakeScheduleSummary,
  isIntakeSchedulePreferenceReady,
  normalizeIntakeScheduleFields,
} from "@/lib/intake-schedule-preference"
import {
  clearIntakeDraft,
  getDraftByPhoneNumber,
  intakeDraftBelongsToPhone,
  intakeDraftPhonesMatch,
  isIntakeDraftMeaningful,
  isIntakeDraftRestoreSecondary,
  isValidIntakeDraftPhone,
  normalizeIntakeDraftPhone,
  saveIntakeDraft,
  shouldOfferIntakeDraftRestore,
  type IntakeDraftSnapshot,
  type IntakeDraftWorkflowStep,
} from "@/lib/intake-draft-storage"
import { formatCollectedDollars } from "@/lib/owner-collected"
import type { StructuredAddress } from "@/lib/structured-address"
import type { CustomerVehicle } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Manual intake micro-step views — branching by service type. */
type WorkflowStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "JOB_TYPE"
  | "KEY_SPECIFICS"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"
  | "CUSTOMER_NAME"
  | "BOOKING_COMPLETE"

const WORKFLOW_STEP_LABELS: Record<WorkflowStep, string> = {
  SERVICE_SELECT: "Service",
  VEHICLE_INFO: "Vehicle",
  JOB_TYPE: "Job type",
  KEY_SPECIFICS: "Lookup notes",
  ADDRESS_CONTACT: "Location",
  SCHEDULE_TIME: "Schedule",
  CUSTOMER_NAME: "Customer",
  BOOKING_COMPLETE: "Done",
}

function formatCrmQuoteChip(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

/**
 * Compact CRM chips for returning callers — garage tap + open-quote hint.
 * Kept light so it never blocks Answer or fights the minimize PiP.
 */
function RepeatCustomerCrmChips({
  garageVehicles,
  crmOpenLeadId,
  crmOpenLeadQuoteCents,
  activeYear,
  activeMake,
  activeModel,
  onPickVehicle,
  compact = false,
}: {
  garageVehicles: CustomerVehicle[]
  crmOpenLeadId: string | null
  crmOpenLeadQuoteCents: number | null
  activeYear: string
  activeMake: string
  activeModel: string
  onPickVehicle: (v: CustomerVehicle) => void
  compact?: boolean
}) {
  const hasGarage = garageVehicles.length > 0
  // Show chip for any open lead — price optional (thin callback leads still count).
  const hasOpenQuote = Boolean(crmOpenLeadId)
  if (!hasGarage && !hasOpenQuote) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "mt-1" : "mt-1.5")}>
      {hasOpenQuote ? (
        <span
          className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100"
          title="Booking upgrades this open quote lead — no duplicate"
        >
          {crmOpenLeadQuoteCents != null && crmOpenLeadQuoteCents > 0
            ? `Open quote · ${formatCrmQuoteChip(crmOpenLeadQuoteCents)}`
            : "Open quote"}
        </span>
      ) : null}
      {garageVehicles.slice(0, 4).map((v) => {
        const label = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"
        const selected =
          activeYear.trim() === (v.year?.trim() || "") &&
          activeMake.trim().toLowerCase() === (v.make?.trim().toLowerCase() || "") &&
          activeModel.trim().toLowerCase() === (v.model?.trim().toLowerCase() || "")
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onPickVehicle(v)}
            className={cn(
              "inline-flex max-w-[11rem] truncate rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
              selected
                ? "border-sky-500/50 bg-sky-500/20 text-sky-100"
                : "border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            )}
            title={`Use ${label}`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Returning-caller profile sheet — CRM history first, actions secondary.
 * Cold callers never see this; they keep the Service-first wizard.
 */
function ReturningCallerDecisionCard({
  customerName,
  phoneDisplay,
  vehicleLabels,
  addressLine,
  lastJobLine,
  lastJobAddress,
  openLeadId,
  openQuoteCents,
  serviceTypeLabel,
  activeJobId,
  activeJobMeta,
  recentHistoryLines,
  lastPaidLine,
  lifetimePaidLine,
  recentCallLine,
  pendingDraft,
  restoreSecondary,
  notesPreview,
  notesHasMore,
  emphasizeJob,
  hasCrmHistory,
  canOpenCrm,
  /** Latest book-form handoff — label the open lead as a customer submit. */
  bookFormSubmitted,
  primaryContinueLabel,
  onPrimaryContinue,
  onRestoreDraft,
  onDismissDraft,
  onOpenCrm,
  onNewJob,
  onToggleNotes,
  notesExpanded,
}: {
  customerName: string
  phoneDisplay: string | null
  vehicleLabels: string[]
  addressLine: string | null
  lastJobLine: string | null
  lastJobAddress: string | null
  openLeadId: string | null
  openQuoteCents: number | null
  serviceTypeLabel: string | null
  activeJobId: string | null
  activeJobMeta: string | null
  recentHistoryLines: string[]
  lastPaidLine: string | null
  lifetimePaidLine: string | null
  recentCallLine: string | null
  pendingDraft: IntakeDraftSnapshot | null
  /** New inbound leg / soft-aged draft — Restore is optional, not the primary CTA. */
  restoreSecondary: boolean
  notesPreview: string | null
  notesHasMore: boolean
  emphasizeJob: boolean
  /** CRM match / open lead / garage / active job — not draft-only. */
  hasCrmHistory: boolean
  canOpenCrm: boolean
  bookFormSubmitted?: boolean
  primaryContinueLabel: string | null
  onPrimaryContinue: () => void
  onRestoreDraft: () => void
  onDismissDraft: () => void
  onOpenCrm: () => void
  onNewJob: () => void
  onToggleNotes: () => void
  notesExpanded: boolean
}) {
  const hasOpenLead = hasContinueableOpenLead(openLeadId)
  const draftStepLabel =
    pendingDraft?.currentStep && WORKFLOW_STEP_LABELS[pendingDraft.currentStep as WorkflowStep]
      ? WORKFLOW_STEP_LABELS[pendingDraft.currentStep as WorkflowStep]
      : null

  // Draft-only (no CRM) — keep a compact chooser, not a fake profile.
  if (!hasCrmHistory) {
    return (
      <div className="mx-3 mt-1 rounded-xl border border-amber-500/35 bg-amber-500/5 px-3 py-2.5 sm:mx-4">
        <p className="text-[11px] font-semibold text-amber-100">Saved draft</p>
        <p className="mt-0.5 text-base font-semibold text-foreground">{customerName}</p>
        {pendingDraft ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Saved {formatDraftSavedAgo(pendingDraft.savedAt)}
            {draftStepLabel ? ` · stopped on ${draftStepLabel}` : ""}
            <button
              type="button"
              onClick={onDismissDraft}
              className="ml-2 text-[10px] font-medium text-amber-200/70 underline-offset-2 hover:text-amber-100 hover:underline"
            >
              Dismiss
            </button>
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-col gap-1.5">
          {pendingDraft ? (
            <button
              type="button"
              onClick={onRestoreDraft}
              className="inline-flex w-full items-center justify-center rounded-lg border border-amber-400/50 bg-amber-400/90 px-3 py-2 text-xs font-semibold text-zinc-950 touch-manipulation hover:bg-amber-300 active:scale-[0.98]"
            >
              Restore draft
            </button>
          ) : null}
          <button
            type="button"
            onClick={onNewJob}
            className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-xs font-semibold text-zinc-200 touch-manipulation hover:border-zinc-500 hover:text-foreground active:scale-[0.98]"
          >
            Start new job
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-3 sm:px-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/90">
            Customer profile
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-tight text-foreground">{customerName}</p>
          {phoneDisplay ? (
            <p className="mt-0.5 font-mono text-xs text-zinc-400">{phoneDisplay}</p>
          ) : null}

          {vehicleLabels.length > 0 ? (
            <p className="mt-2 text-[12px] leading-snug text-zinc-200">
              <span className="text-zinc-500">Vehicle · </span>
              {vehicleLabels.join(" · ")}
            </p>
          ) : null}
          {addressLine ? (
            <p className="mt-1 text-[11px] leading-snug text-zinc-400">
              <span className="text-zinc-500">Address · </span>
              {addressLine}
            </p>
          ) : null}
          {(lastPaidLine || lifetimePaidLine) && (
            <p className="mt-1 text-[11px] leading-snug text-emerald-200/90">
              {lastPaidLine}
              {lastPaidLine && lifetimePaidLine ? " · " : null}
              {lifetimePaidLine}
            </p>
          )}
          {recentCallLine ? (
            <p className="mt-1 text-[11px] font-medium text-amber-400/90">{recentCallLine}</p>
          ) : null}
        </div>

        <div className="mt-2 space-y-1.5">
          {activeJobId ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                Active job
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-amber-50">
                {activeJobMeta || "In progress"}
              </p>
            </div>
          ) : null}
          {hasOpenLead ? (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                {bookFormSubmitted ? "Book form submitted" : "Open quote"}
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-sky-50">
                {openQuoteCents != null && openQuoteCents > 0
                  ? formatCrmQuoteChip(openQuoteCents)
                  : bookFormSubmitted
                    ? "Customer details ready"
                    : "Saved lead"}
                {serviceTypeLabel ? ` · ${serviceTypeLabel}` : ""}
              </p>
            </div>
          ) : null}
          {lastJobLine ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Last job
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-zinc-100">{lastJobLine}</p>
              {lastJobAddress ? (
                <p className="mt-0.5 text-[11px] text-zinc-500">{lastJobAddress}</p>
              ) : null}
            </div>
          ) : null}
          {pendingDraft ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5">
              <p className="text-[11px] text-amber-100/90">
                Draft · {formatDraftSavedAgo(pendingDraft.savedAt)}
                {draftStepLabel ? ` · ${draftStepLabel}` : ""}
                <button
                  type="button"
                  onClick={onDismissDraft}
                  className="ml-2 text-[10px] font-medium text-amber-200/70 underline-offset-2 hover:underline"
                >
                  Dismiss
                </button>
              </p>
            </div>
          ) : null}
        </div>

        {recentHistoryLines.length > 0 ? (
          <div className="mt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Recent history
            </p>
            <ul className="mt-1 space-y-1">
              {recentHistoryLines.map((line) => (
                <li
                  key={line}
                  className="truncate text-[11px] leading-snug text-zinc-300"
                  title={line}
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {notesPreview ? (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              <span className="text-zinc-500">Notes · </span>
              {notesPreview}
            </p>
            {notesHasMore || notesExpanded ? (
              <button
                type="button"
                onClick={onToggleNotes}
                className="mt-1 text-[10px] font-medium text-sky-300/80 underline-offset-2 hover:underline"
              >
                {notesExpanded ? "Hide notes" : "View notes"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:px-4">
        <div className="flex flex-col gap-1.5">
          {primaryContinueLabel ? (
            <button
              type="button"
              onClick={onPrimaryContinue}
              className={cn(
                "inline-flex w-full items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-semibold touch-manipulation transition-colors active:scale-[0.98]",
                emphasizeJob
                  ? "border-amber-400/60 bg-amber-500/25 text-amber-50 hover:bg-amber-500/35"
                  : "border-sky-400/60 bg-sky-500/25 text-sky-50 hover:bg-sky-500/35"
              )}
            >
              {primaryContinueLabel}
            </button>
          ) : null}
          {canOpenCrm ? (
            <button
              type="button"
              onClick={onOpenCrm}
              className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 touch-manipulation hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
            >
              Open CRM
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {pendingDraft && restoreSecondary ? (
              <button
                type="button"
                onClick={onRestoreDraft}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 touch-manipulation hover:border-zinc-500 hover:text-foreground"
              >
                Restore draft
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNewJob}
              className="inline-flex flex-1 items-center justify-center rounded-lg border border-zinc-700 bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 touch-manipulation hover:border-zinc-500 hover:text-zinc-200"
            >
              Start new job
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Live-call automotive flow (Key Squad):
 * Service → Copy vs AKL → YMM → Address (before quote, esp. AKL) → Customer / quote → Schedule → book.
 * In-app FCC/key catalog search is no longer a required step — look keys up on 3rd-party sites.
 * Vehicle lockout: Service → Vehicle (light) → Location → Customer → Schedule → …
 * Residential / commercial: Service → Location → Customer → Schedule → …
 */
function manualWorkflowPath(
  serviceTypeId: ServiceQuoteTypeId,
  vehicleLockoutIntake = false
): WorkflowStep[] {
  const path: WorkflowStep[] = ["SERVICE_SELECT"]
  if (serviceTypeRequiresVehicle(serviceTypeId)) {
    // Copy vs AKL first, then simple YMM — skip forced KEY_SPECIFICS
    path.push("JOB_TYPE", "VEHICLE_INFO")
  } else if (vehicleLockoutIntake) {
    path.push("VEHICLE_INFO")
  }
  // Location → Customer / quote / outcomes → Schedule → Booking summary
  path.push("ADDRESS_CONTACT", "CUSTOMER_NAME", "SCHEDULE_TIME", "BOOKING_COMPLETE")
  return path
}

function nextStepAfterVehicleInfo(
  _serviceTypeId: ServiceQuoteTypeId,
  _vehicleLockoutIntake = false
): WorkflowStep {
  // Always get address next (AKL needs distance before quoting)
  return "ADDRESS_CONTACT"
}

const PRIMARY_JOB_TYPE_OPTIONS = SERVICE_QUOTE_TYPES.filter((service) =>
  (PRIMARY_JOB_TYPE_IDS as readonly string[]).includes(service.id)
)
const SECONDARY_JOB_TYPE_OPTIONS = SERVICE_QUOTE_TYPES.filter((service) =>
  (SECONDARY_JOB_TYPE_IDS as readonly string[]).includes(service.id)
)

function previousWorkflowStep(path: WorkflowStep[], current: WorkflowStep): WorkflowStep | null {
  const idx = path.indexOf(current)
  if (idx <= 0) return null
  return path[idx - 1] ?? null
}

function IntakeStepProgress({ path, currentStep }: { path: WorkflowStep[]; currentStep: WorkflowStep }) {
  const currentIndex = Math.max(0, path.indexOf(currentStep))
  // Thin stepper strip — deep intake steps need every pixel for year / address taps.
  return (
    <div className="flex min-w-0 items-center gap-1 border-b border-border/60 px-4 py-0.5">
      {path.map((step, index) => {
        const active = step === currentStep
        const done = index < currentIndex
        return (
          <div
            key={step}
            className={cn(
              "h-1 w-1 shrink-0 rounded-full transition-colors",
              active ? "bg-primary" : done ? "bg-primary/50" : "bg-muted"
            )}
            title={WORKFLOW_STEP_LABELS[step]}
          />
        )
      })}
      <span className="truncate text-[10px] font-semibold text-foreground">
        {WORKFLOW_STEP_LABELS[currentStep]}
      </span>
    </div>
  )
}

function ManualIntakeToolbar({
  path,
  currentStep,
  phoneDisplay,
  lineState,
  onLineStateChange,
  onMinimize,
}: {
  path: WorkflowStep[]
  currentStep: WorkflowStep
  phoneDisplay: string
  lineState: ManualCallStatus
  onLineStateChange: (status: ManualCallStatus) => void
  onMinimize?: () => void
}) {
  const currentIndex = Math.max(0, path.indexOf(currentStep))
  // Match live answered sheet: keep chrome thin so Vehicle year taps stay easy.
  const deepStep = currentStep !== "SERVICE_SELECT" && currentStep !== "BOOKING_COMPLETE"
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 pr-12",
        deepStep ? "px-3 pb-2 pt-1.5" : "px-3 pb-3.5 pt-2"
      )}
    >
      <div className="flex items-center gap-2">
        {onMinimize ? (
          <button
            type="button"
            onClick={onMinimize}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
              deepStep ? "h-7 w-7" : "h-8 w-8"
            )}
            aria-label="Minimize intake"
            title="Minimize"
          >
            <ChevronDown className={cn(deepStep ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {path.map((step, index) => {
            const active = step === currentStep
            const done = index < currentIndex
            return (
              <div
                key={step}
                className={cn(
                  "h-1 w-1 shrink-0 rounded-full transition-colors",
                  active ? "bg-primary" : done ? "bg-primary/50" : "bg-muted"
                )}
                title={WORKFLOW_STEP_LABELS[step]}
              />
            )
          })}
          <span className="truncate text-[10px] font-semibold text-foreground">
            {WORKFLOW_STEP_LABELS[currentStep]}
          </span>
        </div>
        <Select value={lineState} onValueChange={(v) => onLineStateChange(v as ManualCallStatus)}>
          <SelectTrigger
            id="manual-call-status"
            aria-label="Line state"
            className="h-7 w-[6.75rem] shrink-0 border-border/60 px-2 text-[10px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ringing">Ringing</SelectItem>
            <SelectItem value="answered">Answered</SelectItem>
            <SelectItem value="on_hold">On hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {phoneDisplay ? (
        <p className="mt-1 mb-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <Phone className="h-3 w-3 shrink-0 text-primary/80" aria-hidden />
          {phoneDisplay}
        </p>
      ) : null}
    </div>
  )
}

/** Animated shell — one step fills the sheet; absolute so steps never stack in the flex column. */
const MANUAL_STEP_SHELL = "absolute inset-0 flex min-h-0 flex-col overflow-hidden"

const MANUAL_STEP_SCROLL =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-auto touch-pan-y pb-4 [-webkit-overflow-scrolling:touch]"

/** Step transitions — opacity only so transforms never swallow mobile taps. */
const MANUAL_STEP_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, pointerEvents: "none" as const },
  transition: { duration: 0.18 },
}

function IntakeAutoSaveStatus({
  saveState,
  draftPulse,
}: {
  saveState: "idle" | "saving" | "saved" | "error"
  draftPulse: boolean
}) {
  return (
    <motion.span
      layout
      className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
      animate={
        draftPulse
          ? { scale: [1, 1.08, 1], color: "rgb(52 211 153 / 0.95)" }
          : { scale: 1, color: "rgb(161 161 170 / 0.9)" }
      }
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
    >
      {saveState === "saving" ? "Saving…" : null}
      {saveState === "saved" ? "Saved." : null}
      {saveState === "error" ? "Save failed." : null}
      {saveState === "idle" ? (
        <>
          <motion.span
            layout
            className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
            animate={
              draftPulse
                ? { scale: [1, 1.5, 1], opacity: [0.45, 1, 0.65], boxShadow: "0 0 8px rgba(52,211,153,0.9)" }
                : { scale: 1, opacity: 0.45, boxShadow: "0 0 0px rgba(52,211,153,0)" }
            }
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            aria-hidden
          />
          Auto-save on.
        </>
      ) : null}
    </motion.span>
  )
}

/** Relative age label for the restore chip (e.g. "12 min ago"). */
function formatDraftSavedAgo(savedAt: string, nowMs = Date.now()): string {
  const saved = new Date(savedAt).getTime()
  if (!Number.isFinite(saved)) return "earlier"
  const mins = Math.max(0, Math.round((nowMs - saved) / 60_000))
  if (mins < 1) return "just now"
  if (mins === 1) return "1 min ago"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours === 1 ? "1 hr ago" : `${hours} hr ago`
}

/** Clear chip: one-tap restore after refresh/crash; dismiss keeps draft for later. */
function IntakeDraftRestoreBanner({
  draft,
  onRestore,
  onDismiss,
}: {
  draft: IntakeDraftSnapshot
  onRestore: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className="mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 sm:mx-4"
      role="status"
      aria-live="polite"
    >
      <p className="min-w-0 flex-1 text-xs font-medium text-amber-50">
        Saved draft from {formatDraftSavedAgo(draft.savedAt)}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex h-8 items-center rounded-lg bg-amber-400/90 px-2.5 text-[11px] font-semibold text-zinc-950 hover:bg-amber-300"
        >
          Restore draft
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold text-amber-100/80 hover:bg-amber-500/20 hover:text-amber-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function IntakeDraftRestoredFlash({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="draft-restored"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[160] flex justify-center px-4 sm:bottom-8"
          role="status"
          aria-live="polite"
        >
          <p className="rounded-full border border-emerald-500/40 bg-slate-950/95 px-4 py-2 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur">
            Draft restored.
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** After ring, poll ringing + answered APIs — backup when Pusher is slow. */
const RINGING_LOOKUP_DELAYS_MS = [0, 50, 150, 350]
/** While a call is ringing, poll quickly until answered_at lands in Neon. */
const RINGING_FAST_POLL_MS = 400
const RINGING_FAST_POLL_MAX_MS = 45_000
/**
 * Safety-net poll while the dashboard tab is visible.
 * With Pusher: slow fallback. Without: still moderate (not sub-second).
 */
const ANSWERED_VISIBILITY_POLL_MS_REALTIME = 12_000
const ANSWERED_VISIBILITY_POLL_MS_FALLBACK = 3_000

/** True when intake is mid-call (answered / on hold) — secondary rings should not steal the sheet. */
function isIntakeCallActive(row: ActiveCallRow | null): boolean {
  if (!row) return false
  // Hangup chrome (`completed` / ended_at) means the leg is dead — form stays open, call is not.
  if (row.manualCallStatus === "completed" || row.ended_at) return false
  if (row.manualCallStatus === "answered" || row.manualCallStatus === "on_hold") return true
  if (row.manualCallStatus === "ringing") return false
  return Boolean(row.answered_at)
}

/** Match Pusher hangup payload to the open intake row (call_log id, ring alias, or caller digits). */
function callRowMatchesHangup(row: ActiveCallRow, payload: OwnerCallCompletedPayload): boolean {
  const callLogId = String(payload.call_log_id ?? "").trim()
  const callSid = String(payload.call_sid ?? "").trim()
  if (callLogId && (row.id === callLogId || row.sourceCallLogId === callLogId)) return true
  if (callSid && row.id === `ring-${callSid}`) return true
  const fromDigits = phoneDigitsKey(payload.from_number)
  if (fromDigits && phoneDigitsKey(row.from_number) === fromDigits) return true
  return false
}

function applyCallEndedPatch(
  row: ActiveCallRow,
  payload: OwnerCallCompletedPayload
): ActiveCallRow {
  const missed = isMissedCallTelemetry(payload)
  const statusNorm = String(payload.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  const terminal =
    Boolean(payload.ended_at?.trim()) ||
    ["completed", "busy", "failed", "no-answer", "canceled", "cancelled"].includes(statusNorm)
  const callType =
    payload.call_type ??
    (missed
      ? String(payload.routed_to_name ?? "").toLowerCase().includes("voicemail")
        ? "voicemail"
        : "missed"
      : row.call_type)
  return {
    ...row,
    // Mid-call demotion (Lyncr VM / AI) may fire call-completed before hangup — keep sheet open.
    manualCallStatus: terminal ? "completed" : row.manualCallStatus === "answered" ? "ringing" : row.manualCallStatus,
    ended_at: terminal ? payload.ended_at ?? new Date().toISOString() : row.ended_at ?? null,
    // Missed / voicemail must not keep a false cell-VM answered_at (green Answered).
    answered_at: missed ? null : row.answered_at ?? payload.answered_at ?? null,
    call_type: callType ?? null,
    status: payload.status ?? row.status ?? null,
    routed_to_name: payload.routed_to_name ?? row.routed_to_name ?? null,
    duration_seconds:
      payload.duration_seconds != null ? payload.duration_seconds : row.duration_seconds ?? null,
    // Prefer quick note when the leg never had a human pickup.
    ...(missed && row.intakeMode !== "full" ? { intakeMode: "quick" as const } : {}),
  }
}

function phoneDigitsKey(raw: string | null | undefined): string {
  const digits = normalizeCallEventPhoneDigits(raw)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

/**
 * True when the operator minimized this same call on purpose (Open CRM / last job / Map).
 * Polls and Pusher must not yank the sheet back open over that destination.
 */
function isSameLegIntentionallyMinimized(
  minimized: boolean,
  open: { id?: string; from_number?: string | null } | null | undefined,
  incoming: { id?: string; from_number?: string | null }
): boolean {
  if (!minimized || !open) return false
  if (open.id && incoming.id && open.id === incoming.id) return true
  const openDigits = phoneDigitsKey(open.from_number)
  const incomingDigits = phoneDigitsKey(incoming.from_number)
  return Boolean(openDigits && incomingDigits && openDigits === incomingDigits)
}

/**
 * True when focus is in an input/textarea/select that is NOT the address autocomplete.
 * Live GPS must not overwrite or steal caret from name, phone, notes, etc.
 */
function isFocusedOnNonAddressField(): boolean {
  if (typeof document === "undefined") return false
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return false
  // Address search uses data-intake-primary-search — exclude it from "elsewhere".
  if (el.hasAttribute("data-intake-primary-search")) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

/** True when the caret is in the service-address autocomplete box. */
function isFocusedOnAddressSearch(): boolean {
  if (typeof document === "undefined") return false
  const el = document.activeElement
  return Boolean(el instanceof HTMLElement && el.hasAttribute("data-intake-primary-search"))
}

/**
 * Skip applying live GPS when the operator is typing elsewhere, editing the
 * address field, or has already entered an address manually.
 */
function shouldSkipLiveGpsAddressUpdate(addressManuallyEdited: boolean): boolean {
  if (addressManuallyEdited) return true
  if (isFocusedOnNonAddressField()) return true
  if (isFocusedOnAddressSearch()) return true
  return false
}

function showCallRow(
  setCurrent: Dispatch<SetStateAction<ActiveCallRow | null>>,
  row: ActiveCallRow,
  dismissed: Set<string>
) {
  if (dismissed.has(row.id)) return
  setCurrent((prev) => {
    if (prev && dismissed.has(prev.id)) return null
    if (prev?.id === row.id) {
      return {
        ...prev,
        ...row,
        answered_at: row.answered_at ?? prev.answered_at,
        ended_at: row.ended_at ?? prev.ended_at,
        caller_name: row.caller_name ?? prev.caller_name,
        recording_url: row.recording_url ?? prev.recording_url,
        manualCallStatus: row.manualCallStatus ?? prev.manualCallStatus,
      }
    }
    return row
  })
}

function rowFromAnsweredPayload(payload: OwnerCallAnsweredPayload): ActiveCallRow | null {
  const callLogId = String(payload.call_log_id ?? "").trim()
  const fromNumber = String(payload.from_number ?? "").trim()
  if (!callLogId || !fromNumber) return null
  return {
    id: callLogId,
    from_number: fromNumber,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: payload.answered_at ?? new Date().toISOString(),
    ended_at: null,
    manualCallStatus: "answered",
  }
}

function rowFromInitiatedPayload(payload: OwnerCallInitiatedPayload): ActiveCallRow | null {
  const fromNumber = String(payload.from_number ?? "").trim()
  if (!fromNumber) return null
  const callLogId = String(payload.call_log_id ?? "").trim()
  const callSid = String(payload.call_sid ?? "").trim()
  const id = callLogId || (callSid ? `ring-${callSid}` : "")
  if (!id) return null
  return {
    id: callLogId || id,
    from_number: fromNumber,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: null,
    ended_at: null,
    manualCallStatus: "ringing",
  }
}

function callLogRowFromApi(row: {
  id: string
  from_number: string
  to_number?: string | null
  caller_name?: string | null
  answered_at?: string | null
  recording_url?: string | null
  routed_to_name?: string | null
  call_type?: string | null
  status?: string | null
}): ActiveCallRow {
  return {
    id: row.id,
    from_number: row.from_number,
    to_number: row.to_number ?? "",
    caller_name: row.caller_name ?? null,
    answered_at: row.answered_at ?? null,
    recording_url: row.recording_url ?? null,
    routed_to_name: row.routed_to_name ?? null,
    call_type: row.call_type ?? null,
    status: row.status ?? null,
  }
}

function fetchFirstUnseenRingingCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetchRecentRingingCalls().then((calls) => {
    for (const row of calls) {
      if (!seen.has(row.id)) return callLogRowFromApi(row)
    }
    return null
  })
}

function fetchRecentRingingCalls(): Promise<ActiveCallRow[]> {
  return fetchRecentRingingCallsResult().then((r) => r.calls)
}

/** Ringing-recent with ok flag — failed polls must not auto-dismiss Incoming Call. */
function fetchRecentRingingCallsResult(): Promise<{ ok: boolean; calls: ActiveCallRow[] }> {
  return fetch("/api/calls/ringing-recent", { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) return { ok: false as const, calls: [] as ActiveCallRow[] }
      const data = (await r.json()) as { calls?: ActiveCallRow[] }
      const calls = Array.isArray(data.calls) ? data.calls.map((row) => callLogRowFromApi(row)) : []
      return { ok: true as const, calls }
    })
    .catch(() => ({ ok: false as const, calls: [] as ActiveCallRow[] }))
}

function fetchCallSummaryForIntake(callLogId: string): Promise<{
  status: string | null
  routed_to_name: string | null
  ended_at: string | null
  answered_at: string | null
} | null> {
  const id = String(callLogId ?? "").trim()
  if (!id || id.startsWith("ring-")) return Promise.resolve(null)
  return fetch(`/api/calls/${encodeURIComponent(id)}/summary`, { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (data: {
        data?: {
          status?: string | null
          routed_to_name?: string | null
          ended_at?: string | null
          answered_at?: string | null
        }
      } | null) => {
        if (!data?.data) return null
        return {
          status: data.data.status ?? null,
          routed_to_name: data.data.routed_to_name ?? null,
          ended_at: data.data.ended_at ?? null,
          answered_at: data.data.answered_at ?? null,
        }
      }
    )
    .catch(() => null)
}

function fetchFirstUnseenAnsweredCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/answered-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) {
          // Belt-and-suspenders: API should already exclude hold waiters.
          if (
            !shouldOpenOwnerAnsweredIntake({
              routed_to_name: row.routed_to_name,
              dial_reason: null,
            })
          ) {
            continue
          }
          return callLogRowFromApi(row)
        }
      }
      return null
    })
    .catch(() => null)
}

function rowFromCompletedPayload(payload: OwnerCallCompletedPayload): ActiveCallRow | null {
  if (!payload.call_log_id || !payload.from_number) return null
  if (isMissedCallTelemetry(payload)) return null
  if (talkSecondsFromCompletedPayload(payload) <= 0) return null
  return {
    id: payload.call_log_id,
    from_number: payload.from_number,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: payload.answered_at ?? new Date().toISOString(),
    ended_at: payload.ended_at ?? new Date().toISOString(),
    // Hangup while intake was closed — reopen with ended chrome (form still usable).
    manualCallStatus: "completed",
  }
}

export type CallAnsweredModalProps = {
  enabled: boolean
  ownerUserId?: string | null
}

export function CallAnsweredModal({ enabled, ownerUserId }: CallAnsweredModalProps) {
  const router = useRouter()
  const { toast } = useToast()
  const dismissedRef = useRef<Set<string>>(new Set())
  const ringAliasRef = useRef<string | null>(null)
  const [current, setCurrent] = useState<ActiveCallRow | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const isMinimizedRef = useRef(false)
  isMinimizedRef.current = isMinimized
  // Blocks Sheet onOpenChange(false) while we intentionally re-open (PiP expand).
  const suppressSheetDismissRef = useRef(false)
  const suppressSheetDismissTimerRef = useRef<number | null>(null)
  // Tab to restore when leaving Map (set in viewOnMapLayout).
  const intakeReturnTabRef = useRef<PageId>("dashboard")
  // Expand intake only after setActiveTab has updated activeTab (no setTimeout reopen).
  const pendingExpandAfterTabRef = useRef<PageId | null>(null)
  const [secondaryIncoming, setSecondaryIncoming] = useState<SecondaryIncomingLeg | null>(null)
  const [lostLeadState, setLostLeadState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [lostLeadError, setLostLeadError] = useState<string | null>(null)
  const [failureReason, setFailureReason] = useState(FAILURE_REASON_NEUTRAL)
  const [recoveredViaRouteDiscount, setRecoveredViaRouteDiscount] = useState(false)
  const [highlightConfirmBook, setHighlightConfirmBook] = useState(false)
  const [negotiationStep, setNegotiationStep] = useState(1)
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("SERVICE_SELECT")
  /** Key specs from unified VIN/plate decode — skips a second key-info fetch. */
  const [preloadedKeyBundle, setPreloadedKeyBundle] = useState<PreloadedVehicleKeyBundle | null>(null)
  /** True while push/turn or multi-FCC Ask-the-customer is unanswered — hide key blanks. */
  const [keyClarificationPending, setKeyClarificationPending] = useState(false)
  /** Rapid Vehicle Lockout — insert a light Vehicle step before Location. */
  const [vehicleLockoutIntake, setVehicleLockoutIntake] = useState(false)
  /** JOB_TYPE: show programming / ignition / extraction under More. */
  const [showMoreJobTypes, setShowMoreJobTypes] = useState(false)
  /** Soft-gate: second tap skips Key details without a blank (non-AKL). */
  const [keySkipArmed, setKeySkipArmed] = useState(false)
  /** Busy flag while texting /book invite from intake outcomes. */
  const [bookingLinkOpen, setBookingLinkOpen] = useState(false)
  /** Busy flag while creating + texting $49 service-call form+pay link. */
  const [serviceCallLinkBusy, setServiceCallLinkBusy] = useState(false)
  /** Hide returning-caller decision card after View job / Continue / New job / Restore. */
  const [callbackChooserDismissed, setCallbackChooserDismissed] = useState(false)
  /** Only true after explicit New job — allows insert instead of open-quote upgrade. */
  const [callbackForceNewJob, setCallbackForceNewJob] = useState(false)
  /** Compact “Continuing draft for {name}” banner after Restore (not the full decision card). */
  const [continuingDraft, setContinuingDraft] = useState(false)
  /** Expand truncated CRM notes on the returning-caller card. */
  const [returningCallerNotesExpanded, setReturningCallerNotesExpanded] = useState(false)
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null)
  /** Confirmation SMS draft after book — must send or skip before Done / Scheduler. */
  const [confirmSmsDraft, setConfirmSmsDraft] = useState<string | null>(null)
  const [confirmSmsResolved, setConfirmSmsResolved] = useState(false)
  const [draftPulse, setDraftPulse] = useState(false)
  /** Phone we already restored this session — do not re-offer the banner. */
  const lastLoadedDraftPhoneRef = useRef<string | null>(null)
  /** Phone whose restore banner was dismissed (draft kept in storage for later). */
  const dismissedDraftPhoneRef = useRef<string | null>(null)
  /**
   * When this intake sheet opened (this call / mount).
   * Drafts saved at or after this time are auto-saves from the current session —
   * never offer "Restore draft" for those (the form already has them).
   */
  const intakeSessionStartedAtRef = useRef<number>(Date.now())
  const draftPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextDraftSaveRef = useRef(false)
  /** Restorable draft for the current caller — shown as an explicit Restore chip. */
  const [pendingDraft, setPendingDraft] = useState<IntakeDraftSnapshot | null>(null)
  // Friendly flash after the operator taps Restore draft.
  const [draftRestoredFlash, setDraftRestoredFlash] = useState(false)
  const draftRestoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualStepScrollRef = useRef<HTMLDivElement>(null)
  const addressSearchRef = useRef<JobAddressAutocompleteHandle>(null)
  // Cancels stale live-GPS reverse-geocode when a newer ping arrives.
  const geocodeAbortControllerRef = useRef<AbortController | null>(null)
  // Once the operator types/picks an address, live GPS must not clobber it.
  const addressManuallyEditedRef = useRef(false)
  const { activeOrganizationId, activeTab, setActiveTab } = useDashboardWorkspace()
  const lyncEngine = useLyncEngineOptional()
  const { manualCallRow, patchManualCallRow, clearManualCallRow } = useInboundCallPanel()
  const manualCallRowRef = useRef(manualCallRow)
  manualCallRowRef.current = manualCallRow
  const effectiveCurrent = manualCallRow ?? current
  const isCallActive = isIntakeCallActive(effectiveCurrent)
  const isCallActiveRef = useRef(isCallActive)
  isCallActiveRef.current = isCallActive
  const effectiveCurrentRef = useRef(effectiveCurrent)
  effectiveCurrentRef.current = effectiveCurrent

  // Clear PiP when intake closes; keep form memory while minimized (sheet only hides).
  useEffect(() => {
    if (!effectiveCurrent) setIsMinimized(false)
  }, [effectiveCurrent])

  const linkManualCallLog = useCallback(
    (patch: Partial<ActiveCallRow>) => {
      patchManualCallRow(patch)
    },
    [patchManualCallRow]
  )

  const {
    form,
    matchedCustomer,
    garageVehicles,
    crmServiceHistory,
    crmPayments,
    crmLifetimeRevenueCents,
    crmOpenLeadId,
    crmOpenLeadQuoteCents,
    crmOpenLeadServiceTypeId,
    applyGarageVehicle,
    applyOpenQuoteContinuePrefill,
    startFreshJobForReturningCaller,
    resolvedPhoneNumber,
    patchForm,
    resetForm,
    setServiceQuoteTypeId,
    setQuotedPriceDollars,
    syncQuotedPriceToAuto,
    liveQuote,
    travelDistanceMiles,
    dispatcherLocation,
    setVehicle,
    applyVehicleClarification,
    applyFccAutoResolved,
    setVehicleKeySelection,
    setServiceAddress,
    commitAddressQuery,
    saveState,
    jobState,
    jobError,
    setJobError,
    setJobState,
    createJob,
    canDispatch,
    canSavePendingLead,
    canSaveQuoteLead,
    addressReady,
    dispatchBlockers,
    addressSeedQuery,
    answeredClarificationIds,
  } = useActiveCallForm(effectiveCurrent, { linkManualCallLog })

  const [gpsRequestState, setGpsRequestState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  // Live gallery for customer job photos (ignition / lockout) from /upload SMS.
  const [jobPhotos, setJobPhotos] = useState<IntakeJobPhoto[]>([])
  const setJobPhotosRef = useRef(setJobPhotos)
  setJobPhotosRef.current = setJobPhotos
  // Pending Info Intake rescue profile (name / VIN decode / notes).
  const [rescueMeta, setRescueMeta] = useState<IntakeRescueMeta | null>(null)
  const setRescueMetaRef = useRef(setRescueMeta)
  setRescueMetaRef.current = setRescueMeta
  const setServiceAddressRef = useRef(setServiceAddress)
  setServiceAddressRef.current = setServiceAddress
  const patchFormRef = useRef(patchForm)
  patchFormRef.current = patchForm
  const setVehicleRef = useRef(setVehicle)
  setVehicleRef.current = setVehicle
  const formNotesRef = useRef(form.notes)
  formNotesRef.current = form.notes
  const effectiveCurrentIdRef = useRef(effectiveCurrent?.id ?? null)
  effectiveCurrentIdRef.current = effectiveCurrent?.id ?? null

  // Park secondary rings in the overhead banner instead of replacing live intake.
  useEffect(() => {
    if (!lyncEngine || !isCallActive || !effectiveCurrent) {
      return
    }
    const primaryDigits = phoneDigitsKey(form.phoneNumber || effectiveCurrent.from_number)
    const secondary = lyncEngine.activeCalls.find((call) => {
      if (call.phase !== "ringing") return false
      const digits = phoneDigitsKey(call.fromNumber)
      if (!digits || !primaryDigits) return true
      return digits !== primaryDigits
    })
    if (!secondary) return
    setSecondaryIncoming((prev) => {
      if (prev?.callSid === secondary.callSid) return prev
      return {
        callSid: secondary.callSid,
        callLogId: secondary.callLogId,
        fromNumber: secondary.fromNumber,
        toNumber: secondary.toNumber,
      }
    })
  }, [lyncEngine, lyncEngine?.activeCalls, isCallActive, effectiveCurrent, form.phoneNumber])

  // Drop secondary banner when that leg leaves the engine.
  useEffect(() => {
    if (!secondaryIncoming || !lyncEngine) return
    const stillRinging = lyncEngine.activeCalls.some(
      (c) => c.callSid === secondaryIncoming.callSid && c.phase === "ringing"
    )
    if (!stillRinging) setSecondaryIncoming(null)
  }, [lyncEngine, lyncEngine?.activeCalls, secondaryIncoming])

  const autoTotalDollars =
    liveQuote.totalCents > 0 ? Math.round(liveQuote.totalCents / 100) : 0
  const [customPrice, setCustomPrice] = useState("")
  /** System line-item estimate vs flat negotiated lock (from Exact Price Workspace). */
  const [flatPriceMeta, setFlatPriceMeta] = useState<{
    calculatedCents: number
    finalCents: number
    isOverridden: boolean
  } | null>(null)
  const [negotiationDiscountApplied, setNegotiationDiscountApplied] =
    useState<NegotiationDiscountId | null>(null)
  const [negotiationDiscountsTried, setNegotiationDiscountsTried] = useState<NegotiationDiscountId[]>([])

  useEffect(() => {
    setNegotiationDiscountApplied(null)
    setNegotiationDiscountsTried([])
    setFailureReason(FAILURE_REASON_NEUTRAL)
    setRecoveredViaRouteDiscount(false)
    setHighlightConfirmBook(false)
    setNegotiationStep(1)
    setCurrentStep("SERVICE_SELECT")
    setVehicleLockoutIntake(false)
    setShowMoreJobTypes(false)
    setKeySkipArmed(false)
    setCallbackChooserDismissed(false)
    setCallbackForceNewJob(false)
    setContinuingDraft(false)
    setReturningCallerNotesExpanded(false)
    // Mark a fresh intake session so same-session auto-saves never show Restore.
    intakeSessionStartedAtRef.current = Date.now()
    lastLoadedDraftPhoneRef.current = null
    dismissedDraftPhoneRef.current = null
    setPendingDraft(null)
    // Reset attachments when a new call / ticket opens.
    setJobPhotos([])
    setRescueMeta(null)
    setGpsRequestState("idle")
    setDraftRestoredFlash(false)
    setBookedLeadId(null)
    setConfirmSmsDraft(null)
    setConfirmSmsResolved(false)
    // New call — allow live GPS to fill address until the operator edits it.
    addressManuallyEditedRef.current = false
  }, [effectiveCurrent?.id])

  // When rescue metadata arrives (hydrate or live), autofill name / vehicle into the form.
  useEffect(() => {
    if (!rescueMeta || rescueMeta.ticket_status !== "info_received") return
    if (rescueMeta.customer_name?.trim()) {
      patchForm({ displayName: rescueMeta.customer_name.trim() })
    }
    if (rescueMeta.vehicle_year || rescueMeta.vehicle_make || rescueMeta.vehicle_model) {
      setVehicle({
        vehicle_year: rescueMeta.vehicle_year || "",
        vehicle_make: rescueMeta.vehicle_make || "",
        vehicle_model: rescueMeta.vehicle_model || "",
      })
    }
    if (rescueMeta.vehicle_trim?.trim()) {
      patchForm({ vehicleTrim: rescueMeta.vehicle_trim.trim() })
    }
    if (rescueMeta.special_notes?.trim() && !form.notes.trim()) {
      patchForm({ notes: rescueMeta.special_notes.trim() })
    }
    // Only re-run when ticket flips to info_received for this call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescueMeta?.ticket_status, rescueMeta?.customer_name, rescueMeta?.vehicle_vin, effectiveCurrent?.id])


  const activeDraftPhone = useMemo(() => {
    // Prefer the live call's from_number so a call switch never offers the
    // previous caller's draft while form state is still catching up.
    const callPhone = effectiveCurrent?.from_number?.trim() || ""
    if (callPhone && isValidIntakeDraftPhone(callPhone)) return callPhone
    // Manual dial pad may only have the typed form phone before from_number syncs.
    if (effectiveCurrent?.isManual) {
      const formPhone = form.phoneNumber.trim()
      return isValidIntakeDraftPhone(formPhone) ? formPhone : null
    }
    // Never fall back to a stale form phone for live inbound — that loads
    // the previous caller's draft onto a brand-new ring.
    return null
  }, [form.phoneNumber, effectiveCurrent?.from_number, effectiveCurrent?.isManual])

  /**
   * Offer an explicit Restore draft chip when a fresh, meaningful draft exists
   * for THIS caller from a *previous* open — never auto-hydrate, never another
   * phone, never the auto-save we just wrote in this session.
   */
  useEffect(() => {
    if (!effectiveCurrent || !activeDraftPhone) {
      setPendingDraft(null)
      return
    }
    const normalized = normalizeIntakeDraftPhone(activeDraftPhone)
    if (!normalized) {
      setPendingDraft(null)
      return
    }
    const formPhone = form.phoneNumber.trim()
    const callPhone = effectiveCurrent.from_number?.trim() || ""
    // Inbound must have a ringing E.164 before we offer any draft.
    if (!effectiveCurrent.isManual && !callPhone) {
      setPendingDraft(null)
      return
    }
    // Form still on a different number than the open call — wait for sync.
    if (
      formPhone &&
      callPhone &&
      isValidIntakeDraftPhone(formPhone) &&
      isValidIntakeDraftPhone(callPhone) &&
      !intakeDraftPhonesMatch(formPhone, callPhone)
    ) {
      setPendingDraft(null)
      return
    }
    // Already restored or dismissed for this phone this session.
    if (
      lastLoadedDraftPhoneRef.current === normalized ||
      dismissedDraftPhoneRef.current === normalized
    ) {
      setPendingDraft(null)
      return
    }
    // Only consider drafts that belong to THIS caller phone.
    const draft = getDraftByPhoneNumber(activeDraftPhone)
    if (!draft || !intakeDraftBelongsToPhone(draft, activeDraftPhone)) {
      if (draft) clearIntakeDraft(activeDraftPhone)
      setPendingDraft(null)
      return
    }
    // Belt + suspenders: draft must also match the ringing E.164 when present.
    if (callPhone && !intakeDraftBelongsToPhone(draft, callPhone)) {
      clearIntakeDraft(activeDraftPhone)
      setPendingDraft(null)
      return
    }
    // Skip same-session auto-save and drafts that already match the live form
    // (e.g. operator just tapped AKL — "Restore" would be a no-op).
    if (
      !shouldOfferIntakeDraftRestore({
        draft,
        phone: activeDraftPhone,
        sessionStartedAtMs: intakeSessionStartedAtRef.current,
        liveForm: form,
        liveStep: currentStep as IntakeDraftWorkflowStep,
      })
    ) {
      setPendingDraft(null)
      return
    }
    setPendingDraft(draft)
    // Re-check when step/form progress changes so a just-written auto-save
    // never sticks the Restore banner on screen mid-typing.
  }, [effectiveCurrent, activeDraftPhone, form, currentStep])

  /** One-tap: restore form, clear false Lockout, land on first incomplete step. */
  const restorePendingDraft = useCallback(() => {
    if (!pendingDraft || !activeDraftPhone || !effectiveCurrent) return
    const normalized = normalizeIntakeDraftPhone(activeDraftPhone)
    if (!normalized) return
    // Guard: draft must belong to the open caller phone.
    if (!intakeDraftBelongsToPhone(pendingDraft, activeDraftPhone)) {
      clearIntakeDraft(activeDraftPhone)
      setPendingDraft(null)
      return
    }
    const draftForm = pendingDraft.form
    // Prefer CRM type over an autosaved Lockout default (same spirit as Continue quote).
    const resolvedService = resolveRestoredDraftServiceTypeId({
      draftServiceTypeId: draftForm.serviceQuoteTypeId,
      crmServiceTypeId: crmOpenLeadServiceTypeId,
      notes: draftForm.notes,
      jobType: draftForm.jobType,
      savedStep: pendingDraft.currentStep,
    })
    // Fill missing YMM from garage / CRM so Restore can skip Vehicle when the car is known.
    const ymm = resolveOpenQuoteYmm({
      lead: {
        vehicle_year: draftForm.vehicleYear,
        vehicle_make: draftForm.vehicleMake,
        vehicle_model: draftForm.vehicleModel,
      },
      garage: garageVehicles[0] ?? null,
    })
    const year = draftForm.vehicleYear.trim() || ymm.year
    const make = draftForm.vehicleMake.trim() || ymm.make
    const model = draftForm.vehicleModel.trim() || ymm.model
    // Keep CRM address when the draft never collected one (notes-only thin drafts).
    const addressLine1 = draftForm.addressLine1.trim() || form.addressLine1
    const city = draftForm.city.trim() || form.city
    const addressReadyNow =
      addressReady ||
      isFlatAddressReadyForDispatch({ addressLine1, city })

    skipNextDraftSaveRef.current = true
    const restoredSchedule = normalizeIntakeScheduleFields({
      scheduleUrgency: draftForm.scheduleUrgency,
      scheduledDate: draftForm.scheduledDate,
      scheduledTime: draftForm.scheduledTime,
      availabilityFrom: draftForm.availabilityFrom,
      availabilityTo: draftForm.availabilityTo,
    })
    patchForm({
      ...draftForm,
      ...restoredSchedule,
      serviceQuoteTypeId: resolvedService,
      displayName: draftForm.displayName.trim() || form.displayName,
      vehicleYear: year,
      vehicleMake: make,
      vehicleModel: model,
      addressLine1,
      addressLine2: draftForm.addressLine2.trim() || form.addressLine2,
      city,
      region: draftForm.region.trim() || form.region,
      postalCode: draftForm.postalCode.trim() || form.postalCode,
      serviceAddress: draftForm.serviceAddress || form.serviceAddress,
    })
    if (!draftForm.phoneNumber?.trim() && effectiveCurrent.from_number?.trim()) {
      patchForm({ phoneNumber: effectiveCurrent.from_number.trim() })
    }
    // First incomplete step — prefer later of saved vs computed so mid-flow is not yanked back.
    const next = resumeDraftIntakeStep({
      serviceTypeId: resolvedService,
      vehicleYear: year,
      vehicleMake: make,
      vehicleModel: model,
      addressReady: addressReadyNow,
      savedStep: pendingDraft.currentStep,
      displayName: draftForm.displayName.trim() || form.displayName,
      scheduledDate: draftForm.scheduledDate || form.scheduledDate,
      scheduledTime: draftForm.scheduledTime || form.scheduledTime,
    })
    setCurrentStep(next as WorkflowStep)
    setCustomPrice(pendingDraft.customPrice)
    setFailureReason(pendingDraft.failureReason || FAILURE_REASON_NEUTRAL)
    setRecoveredViaRouteDiscount(pendingDraft.recoveredViaRouteDiscount)
    setNegotiationStep(pendingDraft.negotiationStep)
    setVehicleLockoutIntake(
      resolvedService === "lockout" &&
        /vehicle\s*lockout/i.test(draftForm.notes || "")
    )
    // Leave decision card; show compact continuing-draft banner instead.
    setCallbackChooserDismissed(true)
    setCallbackForceNewJob(false)
    setContinuingDraft(true)
    lastLoadedDraftPhoneRef.current = normalized
    setPendingDraft(null)
    setDraftRestoredFlash(true)
    if (draftRestoredTimerRef.current) window.clearTimeout(draftRestoredTimerRef.current)
    draftRestoredTimerRef.current = window.setTimeout(() => setDraftRestoredFlash(false), 4200)
  }, [
    addressReady,
    crmOpenLeadServiceTypeId,
    effectiveCurrent,
    form.addressLine1,
    form.addressLine2,
    form.city,
    form.displayName,
    form.postalCode,
    form.region,
    form.serviceAddress,
    form.scheduledDate,
    form.scheduledTime,
    garageVehicles,
    pendingDraft,
    activeDraftPhone,
    patchForm,
  ])

  /** Dismiss keeps the draft in storage for later; hide the chip this session. */
  const dismissPendingDraft = useCallback(() => {
    if (activeDraftPhone) {
      dismissedDraftPhoneRef.current = normalizeIntakeDraftPhone(activeDraftPhone)
    }
    setPendingDraft(null)
  }, [activeDraftPhone])

  // useLyncEngine onCallDisconnect may inject an AI transcript stub into the draft —
  // merge into the open form so autosave does not clobber it.
  useEffect(() => {
    const onInjected = (event: Event) => {
      const detail = (event as CustomEvent<{ phone?: string; notes?: string }>).detail
      const phone = String(detail?.phone ?? "").trim()
      const notes = String(detail?.notes ?? "")
      if (!phone || !notes || !activeDraftPhone) return
      const a = normalizeIntakeDraftPhone(phone)
      const b = normalizeIntakeDraftPhone(activeDraftPhone)
      if (!a || !b || a !== b) return
      if (form.notes.includes("[AI Transcript Draft Summary]")) return
      patchForm({ notes })
    }
    window.addEventListener("lyncr-ai-transcript-injected", onInjected)
    return () => window.removeEventListener("lyncr-ai-transcript-injected", onInjected)
  }, [activeDraftPhone, form.notes, patchForm])

  /** Persist partial intake locally whenever fields / step change (keyed by phone). */
  useEffect(() => {
    if (!effectiveCurrent || !activeDraftPhone) return
    // Do not keep caching after a successful booking.
    if (currentStep === "BOOKING_COMPLETE") return
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false
      return
    }
    const callPhone = effectiveCurrent.from_number?.trim() || ""
    const formPhone = form.phoneNumber.trim()
    // Never write under the ringing number unless the form phone already matches it.
    // Empty form phone is not enough — that was a cross-caller race vector.
    if (!formPhone || !intakeDraftPhonesMatch(formPhone, activeDraftPhone)) {
      return
    }
    if (callPhone && !intakeDraftPhonesMatch(formPhone, callPhone)) {
      return
    }
    const normalized = normalizeIntakeDraftPhone(activeDraftPhone)
    // While a Restore chip is offered, do not overwrite the stored draft with a blank form.
    if (
      pendingDraft ||
      (normalized &&
        lastLoadedDraftPhoneRef.current !== normalized &&
        dismissedDraftPhoneRef.current !== normalized &&
        getDraftByPhoneNumber(activeDraftPhone))
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      // Skip empty Service + Lockout shells — they cause false Restore on the next ring.
      if (
        !isIntakeDraftMeaningful({
          form,
          currentStep,
        })
      ) {
        return
      }
      // Re-check phone match at flush time (form may have switched mid-debounce).
      const latestFormPhone = form.phoneNumber.trim()
      const latestCallPhone = effectiveCurrent.from_number?.trim() || ""
      if (
        latestFormPhone &&
        latestCallPhone &&
        !intakeDraftPhonesMatch(latestFormPhone, latestCallPhone)
      ) {
        return
      }
      const sourceCallLogId =
        effectiveCurrent.sourceCallLogId?.trim() || effectiveCurrent.id || null
      saveIntakeDraft(activeDraftPhone, {
        form,
        currentStep,
        customPrice,
        failureReason,
        recoveredViaRouteDiscount,
        negotiationStep,
        submitted: false,
        sourceCallLogId,
      })
      setDraftPulse(true)
      if (draftPulseTimerRef.current) window.clearTimeout(draftPulseTimerRef.current)
      draftPulseTimerRef.current = window.setTimeout(() => setDraftPulse(false), 1600)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [
    effectiveCurrent,
    activeDraftPhone,
    form,
    currentStep,
    customPrice,
    failureReason,
    recoveredViaRouteDiscount,
    negotiationStep,
    pendingDraft,
  ])

  useEffect(
    () => () => {
      if (draftPulseTimerRef.current) window.clearTimeout(draftPulseTimerRef.current)
      if (draftRestoredTimerRef.current) window.clearTimeout(draftRestoredTimerRef.current)
    },
    []
  )

  useEffect(() => {
    setNegotiationStep(1)
  }, [failureReason])

  useEffect(() => {
    if (!highlightConfirmBook) return
    const timer = window.setTimeout(() => setHighlightConfirmBook(false), 12_000)
    return () => window.clearTimeout(timer)
  }, [highlightConfirmBook])

  useEffect(() => {
    if (!effectiveCurrent) {
      setCustomPrice("")
      setFlatPriceMeta(null)
      setNegotiationStep(1)
      return
    }
    if (!form.quotedPriceOverridden) {
      const next = autoTotalDollars > 0 ? String(autoTotalDollars) : ""
      // Avoid re-render loops when the quote string is already in sync.
      setCustomPrice((prev) => (prev === next ? prev : next))
    }
  }, [effectiveCurrent, autoTotalDollars, form.quotedPriceOverridden])

  const applyCustomPriceToForm = useCallback(() => {
    const raw = customPrice.trim()
    if (!raw) {
      syncQuotedPriceToAuto()
      return liveQuote.totalCents
    }
    const dollars = Number.parseFloat(raw)
    if (Number.isFinite(dollars) && dollars >= 0) {
      setQuotedPriceDollars(dollars)
      return Math.round(dollars * 100)
    }
    return form.quotedPriceCents > 0 ? form.quotedPriceCents : liveQuote.totalCents
  }, [customPrice, form.quotedPriceCents, liveQuote.totalCents, setQuotedPriceDollars, syncQuotedPriceToAuto])

  const resolveLostLeadQuoteCents = useCallback((): number | null => {
    const raw = customPrice.trim()
    if (raw) {
      const dollars = Number.parseFloat(raw)
      if (Number.isFinite(dollars) && dollars >= 0) {
        return Math.round(dollars * 100)
      }
    }
    if (form.quotedPriceCents > 0) return form.quotedPriceCents
    if (liveQuote.totalCents > 0) return liveQuote.totalCents
    return null
  }, [customPrice, form.quotedPriceCents, liveQuote.totalCents])

  const handleQuoteEstimateChange = useCallback(
    (totalCents: number, overridden: boolean) => {
      const dollars = Math.round(totalCents / 100)
      if (overridden) {
        setCustomPrice(String(dollars))
        setQuotedPriceDollars(dollars)
        return
      }
      // Operator hit "Reset to baseline" on the quote card.
      syncQuotedPriceToAuto()
      setCustomPrice(dollars > 0 ? String(dollars) : "")
    },
    [setQuotedPriceDollars, syncQuotedPriceToAuto]
  )

  const handleFlatPriceChange = useCallback(
    (payload: { calculatedCents: number; finalCents: number; isOverridden: boolean }) => {
      setFlatPriceMeta(payload)
      if (payload.isOverridden) {
        const dollars = Math.round(payload.finalCents / 100)
        setCustomPrice(String(dollars))
        setQuotedPriceDollars(dollars)
      }
    },
    [setQuotedPriceDollars]
  )

  const jobCreateExtras = useCallback(
    (quotedPriceCents: number) => {
      const calculatedCents =
        flatPriceMeta?.calculatedCents && flatPriceMeta.calculatedCents > 0
          ? flatPriceMeta.calculatedCents
          : liveQuote.totalCents > 0
            ? liveQuote.totalCents
            : quotedPriceCents
      const finalCents =
        flatPriceMeta?.isOverridden && flatPriceMeta.finalCents > 0
          ? flatPriceMeta.finalCents
          : quotedPriceCents > 0
            ? quotedPriceCents
            : calculatedCents
      return {
        quotedPriceCents: finalCents,
        discountApplied: negotiationDiscountApplied,
        baselineQuotedPriceCents: calculatedCents > 0 ? calculatedCents : null,
        calculatedTotalCents: calculatedCents > 0 ? calculatedCents : null,
        finalBookedTotalCents: finalCents > 0 ? finalCents : null,
        isPriceOverridden: Boolean(flatPriceMeta?.isOverridden),
        recoveredViaRouteDiscount,
        forceNewJob: callbackForceNewJob,
      }
    },
    [
      callbackForceNewJob,
      flatPriceMeta,
      negotiationDiscountApplied,
      liveQuote.totalCents,
      recoveredViaRouteDiscount,
    ]
  )

  const stockFallbackIntake = useMemo(
    () => ({
      caller_e164: resolvedPhoneNumber || effectiveCurrent?.from_number || "",
      customer_name: form.displayName.trim(),
      address_line1: form.addressLine1 || null,
      address_line2: form.addressLine2 || null,
      city: form.city || null,
      region: form.region || null,
      postal_code: form.postalCode || null,
      country: form.country || "US",
      notes: form.notes || null,
      vehicle_year: form.vehicleYear || null,
      vehicle_make: form.vehicleMake || null,
      vehicle_model: form.vehicleModel || null,
      key_fcc_id: form.keyFccId || null,
      key_style: form.keyStyle || null,
      call_log_id:
        effectiveCurrent && !effectiveCurrent.id.startsWith("manual-")
          ? effectiveCurrent.id
          : null,
      organization_id: activeOrganizationId,
      quoted_price_cents: form.quotedPriceCents > 0 ? form.quotedPriceCents : null,
      sku: preloadedKeyBundle?.inventory?.[0]?.sku ?? null,
    }),
    [
      activeOrganizationId,
      effectiveCurrent,
      form.addressLine1,
      form.addressLine2,
      form.city,
      form.country,
      form.displayName,
      form.keyFccId,
      form.keyStyle,
      form.notes,
      form.postalCode,
      form.quotedPriceCents,
      form.region,
      form.vehicleMake,
      form.vehicleModel,
      form.vehicleYear,
      preloadedKeyBundle?.inventory,
      resolvedPhoneNumber,
    ]
  )

  const vehicleResolvedForStock = Boolean(
    form.vehicleYear?.trim() && form.vehicleMake?.trim() && form.vehicleModel?.trim()
  )

  /** Stable Set for clarifications — `new Set(...)` inline was recreating every render. */
  const answeredClarificationSet = useMemo(
    () => new Set(answeredClarificationIds),
    [answeredClarificationIds]
  )

  const handleInventoryLoaded = useCallback(
    (inventory: KeyInventoryApiRow[]) => {
      setPreloadedKeyBundle((prev) => {
        const prevList = prev?.inventory ?? []
        // Skip no-op updates so Key Details does not re-enter its load effect.
        if (
          prevList.length === inventory.length &&
          prevList.every(
            (row, index) =>
              row.id === inventory[index]?.id &&
              row.sku === inventory[index]?.sku &&
              // KeyInventoryApiRow has no `quantity` — comparing it was undefined ===
              // undefined, i.e. always true, so stock changes looked like no-ops and the
              // stale list was kept. Compare what the stock warning actually reads.
              row.totalQuantity === inventory[index]?.totalQuantity &&
              row.vanQuantity === inventory[index]?.vanQuantity
          )
        ) {
          return prev
        }
        if (prev) return { ...prev, inventory }
        return {
          year: form.vehicleYear,
          make: form.vehicleMake,
          model: form.vehicleModel,
          key_info: null,
          lookup_source: null,
          inventory,
        }
      })
    },
    [form.vehicleMake, form.vehicleModel, form.vehicleYear]
  )

  const mergeInventoryItem = useCallback((item: KeyInventoryApiRow) => {
    setPreloadedKeyBundle((prev) => {
      const base: PreloadedVehicleKeyBundle = prev ?? {
        year: form.vehicleYear,
        make: form.vehicleMake,
        model: form.vehicleModel,
        key_info: null,
        lookup_source: null,
        inventory: [],
      }
      const list = [...(base.inventory ?? [])]
      const idx = list.findIndex(
        (row) => row.id === item.id || row.sku.toUpperCase() === item.sku.toUpperCase()
      )
      if (idx >= 0) list[idx] = item
      else list.unshift(item)
      return { ...base, inventory: list }
    })
  }, [form.vehicleMake, form.vehicleModel, form.vehicleYear])

  const resolveOwnerUserId = useCallback(async (): Promise<string | null> => {
    if (ownerUserId) return ownerUserId
    try {
      const res = await fetch("/api/auth/session", { credentials: "include" })
      if (!res.ok) return null
      const json = (await res.json()) as { data?: { user?: { id?: string } } }
      return json.data?.user?.id?.trim() || null
    } catch {
      return null
    }
  }, [ownerUserId])

  useEffect(() => {
    if (!ownerUserId) return
    dismissedRef.current = loadAnsweredIntakeDismissed(ownerUserId)
    return subscribeAnsweredIntakeDismissed(ownerUserId, (ids) => {
      for (const id of ids) dismissedRef.current.add(id)
      setCurrent((prev) => (prev && dismissedRef.current.has(prev.id) ? null : prev))
    })
  }, [ownerUserId])

  useEffect(() => {
    if (!enabled || !ownerUserId) return

    dismissedRef.current = loadAnsweredIntakeDismissed(ownerUserId)

    let cancelled = false
    const lookupTimers: ReturnType<typeof window.setTimeout>[] = []
    let ringingFastPollId: ReturnType<typeof window.setInterval> | null = null
    let ringingFastPollStopId: ReturnType<typeof window.setTimeout> | null = null

    const stopRingingFastPoll = () => {
      if (ringingFastPollId != null) {
        window.clearInterval(ringingFastPollId)
        ringingFastPollId = null
      }
      if (ringingFastPollStopId != null) {
        window.clearTimeout(ringingFastPollStopId)
        ringingFastPollStopId = null
      }
    }

    let lookupInFlight = false
    // Brief suppress so Map/Leaflet pointer noise can’t instantly dismiss a just-opened sheet.
    const bumpOpenDismissGuard = () => {
      suppressSheetDismissRef.current = true
      window.setTimeout(() => {
        suppressSheetDismissRef.current = false
      }, 450)
    }

    // Toast when RINGING closes because Busy/hold owns the caller (after full cell ring).
    const toastHoldPath = (_routed: string) => {
      toast({
        title: "Caller went to booking menu",
        description: "Press 1 texts a booking link · stay on the line waits in Lines.",
        action: (
          <ToastAction altText="Open Lines" onClick={() => router.push("/dashboard")}>
            Lines
          </ToastAction>
        ),
      })
    }

    const tryShowActiveCall = () => {
      // Skip overlapping polls — under load these stacked every 800ms.
      if (lookupInFlight || cancelled) return
      lookupInFlight = true
      void fetchRecentRingingCallsResult()
        .then(async (ringingResult) => {
          if (cancelled) return
          // Network / API blip — keep any open RINGING sheet; do not treat as left-ring.
          if (!ringingResult.ok) return
          const ringingCalls = ringingResult.calls
          const ringing =
            ringingCalls.find((row) => !dismissedRef.current.has(row.id)) ?? null
          if (ringing) {
            const sameLegMinimized = isSameLegIntentionallyMinimized(
              isMinimizedRef.current,
              effectiveCurrentRef.current,
              ringing
            )
            showCallRow(setCurrent, ringing, dismissedRef.current)
            // New ring expands; same-leg Open CRM / Map / job keep the PiP.
            if (!sameLegMinimized) {
              isMinimizedRef.current = false
              setIsMinimized(false)
              bumpOpenDismissGuard()
            }
            return
          }

          // RINGING sheet still open but left ringing-recent — hold / hangup / answer race.
          const open = effectiveCurrentRef.current
          if (open && isRingingOnlyIntakeRow(open) && !dismissedRef.current.has(open.id)) {
            const answered = await fetchFirstUnseenAnsweredCall(dismissedRef.current)
            const upgradingToAnswered = Boolean(
              answered &&
                openIntakeMatchesCallLeg(open, {
                  call_log_id: answered.id,
                  from_number: answered.from_number,
                })
            )
            if (upgradingToAnswered && answered) {
              const sameLegMinimized = isSameLegIntentionallyMinimized(
                isMinimizedRef.current,
                open,
                answered
              )
              showCallRow(setCurrent, answered, dismissedRef.current)
              if (!sameLegMinimized) {
                isMinimizedRef.current = false
                setIsMinimized(false)
                bumpOpenDismissGuard()
              }
              stopRingingFastPoll()
              return
            }
            const summary = await fetchCallSummaryForIntake(open.id)
            if (
              shouldDismissRingingIntakeAfterPollMiss({
                open,
                stillRinging: false,
                upgradingToAnswered: false,
                ringingLookupOk: true,
                routedToName: summary?.routed_to_name ?? open.routed_to_name,
                status: summary?.status ?? open.status,
                endedAt: summary?.ended_at ?? open.ended_at,
              })
            ) {
              const ids = [open.id, ringAliasRef.current].filter((id): id is string => Boolean(id))
              markAnsweredIntakeDismissed(ownerUserId, ids)
              for (const id of ids) dismissedRef.current.add(id)
              ringAliasRef.current = null
              const routed = String(
                summary?.routed_to_name ?? open.routed_to_name ?? ""
              ).toLowerCase()
              setCurrent(null)
              isMinimizedRef.current = false
              setIsMinimized(false)
              stopRingingFastPoll()
              // Confirmed hold/Busy after ring timeout — tell the owner why the sheet closed.
              if (
                routed.includes("hold") ||
                routed.includes("busy ·") ||
                routed.includes("busy")
              ) {
                toastHoldPath(routed)
              }
              return
            }
          }

          return fetchFirstUnseenAnsweredCall(dismissedRef.current).then((answered) => {
            if (cancelled || !answered) return
            const sameLegMinimized = isSameLegIntentionallyMinimized(
              isMinimizedRef.current,
              effectiveCurrentRef.current,
              answered
            )
            showCallRow(setCurrent, answered, dismissedRef.current)
            // Keep intentional View-on-Map / Open CRM minimize for the same leg; new legs expand.
            if (!sameLegMinimized) {
              isMinimizedRef.current = false
              setIsMinimized(false)
              bumpOpenDismissGuard()
            }
            stopRingingFastPoll()
          })
        })
        .finally(() => {
          lookupInFlight = false
        })
    }

    const startRingingFastPoll = () => {
      stopRingingFastPoll()
      tryShowActiveCall()
      ringingFastPollId = window.setInterval(() => {
        if (document.visibilityState !== "visible") return
        tryShowActiveCall()
      }, RINGING_FAST_POLL_MS)
      ringingFastPollStopId = window.setTimeout(() => {
        stopRingingFastPoll()
      }, RINGING_FAST_POLL_MAX_MS)
    }

    const scheduleRingingLookups = () => {
      startRingingFastPoll()
      for (const timer of lookupTimers) window.clearTimeout(timer)
      lookupTimers.length = 0
      for (const delayMs of RINGING_LOOKUP_DELAYS_MS) {
        lookupTimers.push(
          window.setTimeout(() => {
            if (cancelled) return
            tryShowActiveCall()
          }, delayMs)
        )
      }
    }

    tryShowActiveCall()

    const pollMs = isRealtimeClientConfigured()
      ? ANSWERED_VISIBILITY_POLL_MS_REALTIME
      : ANSWERED_VISIBILITY_POLL_MS_FALLBACK
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      tryShowActiveCall()
    }, pollMs)

    if (!isRealtimeClientConfigured()) {
      return () => {
        cancelled = true
        stopRingingFastPoll()
        window.clearInterval(pollId)
        for (const timer of lookupTimers) window.clearTimeout(timer)
      }
    }

    const pusher = getPusherClient()
    if (!pusher) {
      return () => {
        cancelled = true
        stopRingingFastPoll()
        window.clearInterval(pollId)
        for (const timer of lookupTimers) window.clearTimeout(timer)
      }
    }

    // Account-wide channel — every OWNER / RECEPTIONIST on the team sees the same intake.
    const channelName = `presence-account-${ownerUserId}`
    const channel = pusher.subscribe(channelName)
    // Keep legacy owner-* subscription for older deploys still publishing only there.
    const legacyChannel = pusher.subscribe(`owner-${ownerUserId}`)
    const channels = [channel, legacyChannel]

    const seenCallSids = new Set<string>()
    const oncePerSid = (sid: string, fn: () => void) => {
      if (!sid) {
        fn()
        return
      }
      const key = `${sid}`
      if (seenCallSids.has(key)) return
      seenCallSids.add(key)
      // Bound memory — drop old keys occasionally.
      if (seenCallSids.size > 200) seenCallSids.clear()
      fn()
    }

    /** Close RINGING / New Intake when Busy → hold (or press-1) owns the caller. */
    const dismissOpenRingingForAutomation = (payload: {
      call_log_id?: string | null
      call_sid?: string | null
      from_number?: string | null
      routed_to_name?: string | null
    }) => {
      const open = effectiveCurrentRef.current
      if (!open || !isRingingOnlyIntakeRow(open)) return false
      if (!openIntakeMatchesCallLeg(open, payload)) return false
      const ids = [open.id, ringAliasRef.current].filter((id): id is string => Boolean(id))
      markAnsweredIntakeDismissed(ownerUserId, ids)
      for (const id of ids) dismissedRef.current.add(id)
      ringAliasRef.current = null
      setCurrent((prev) => (prev && openIntakeMatchesCallLeg(prev, payload) ? null : prev))
      isMinimizedRef.current = false
      setIsMinimized(false)
      setSecondaryIncoming((sec) => {
        if (!sec) return null
        const sid = String(payload.call_sid ?? "").trim()
        if (sid && sec.callSid === sid) return null
        if (payload.call_log_id && sec.callLogId === payload.call_log_id) return null
        return sec
      })
      stopRingingFastPoll()
      return true
    }

    const onInitiated = (payload: OwnerCallInitiatedPayload) => {
      // Hold / Busy / teammate — dismiss outside oncePerSid so a later tag still closes RINGING.
      if (!shouldOpenOwnerRingingIntake(payload)) {
        const routed = String(payload.routed_to_name ?? "").toLowerCase()
        const reason = String(payload.dial_reason ?? "").toLowerCase()
        const dismissed = dismissOpenRingingForAutomation(payload)
        if (
          reason === "busy_automation" ||
          routed.includes("hold") ||
          routed.includes("busy ·")
        ) {
          if (dismissed || shouldDismissOpenRingingIntakeForAutomation(payload)) {
            toastHoldPath(routed)
          }
          // Do NOT poll answered-recent — waiting hold must not open CALL ANSWERED intake.
          return
        }
        scheduleRingingLookups()
        return
      }
      oncePerSid(`i:${String(payload.call_sid ?? "")}`, () => {
        const row = rowFromInitiatedPayload(payload)
        if (!row) {
          scheduleRingingLookups()
          return
        }
        // Active intake owns the sheet — park the second ring in the overhead banner.
        if (isCallActiveRef.current) {
          const primary = effectiveCurrentRef.current
          const primaryDigits = phoneDigitsKey(primary?.from_number)
          const incomingDigits = phoneDigitsKey(row.from_number)
          if (!primaryDigits || !incomingDigits || primaryDigits !== incomingDigits) {
            const callSid = String(payload.call_sid ?? "").trim()
            const callLogId = String(payload.call_log_id ?? "").trim()
            setSecondaryIncoming({
              callSid: callSid || (row.id.startsWith("ring-") ? row.id.slice(5) : row.id),
              callLogId: callLogId || (row.id.startsWith("ring-") ? null : row.id),
              fromNumber: row.from_number,
              toNumber: row.to_number,
            })
            scheduleRingingLookups()
            return
          }
        }
        // Force New Intake open on every inbound ring (even if the sheet was minimized on Map).
        dismissedRef.current.delete(row.id)
        if (payload.call_sid) dismissedRef.current.delete(`ring-${payload.call_sid}`)
        isMinimizedRef.current = false
        setIsMinimized(false)
        bumpOpenDismissGuard()
        showCallRow(setCurrent, row, dismissedRef.current)
        scheduleRingingLookups()
      })
    }

    const onAnswered = (payload: OwnerCallAnsweredPayload) => {
      // Soft-hold / Busy waiting — dismiss RINGING outside oncePerSid so Lines Answer can still open later.
      if (!shouldOpenOwnerAnsweredIntake(payload)) {
        const routed = String(payload.routed_to_name ?? "").toLowerCase()
        if (dismissOpenRingingForAutomation(payload)) {
          toastHoldPath(routed)
        }
        return
      }
      oncePerSid(`a:${String(payload.call_sid ?? payload.call_log_id ?? "")}`, () => {
        const row = rowFromAnsweredPayload(payload)
        if (!row) return
        stopRingingFastPoll()
        // Re-open intake even if this call id was dismissed earlier this session.
        dismissedRef.current.delete(row.id)
        if (payload.call_sid) dismissedRef.current.delete(`ring-${payload.call_sid}`)
        // Don't steal an open intake for a different answered leg (secondary answer is rare).
        if (isCallActiveRef.current) {
          const primary = effectiveCurrentRef.current
          const primaryDigits = phoneDigitsKey(primary?.from_number)
          const answeredDigits = phoneDigitsKey(row.from_number)
          if (primaryDigits && answeredDigits && primaryDigits !== answeredDigits) {
            return
          }
        }
        const sameLegMinimized = isSameLegIntentionallyMinimized(
          isMinimizedRef.current,
          effectiveCurrentRef.current,
          row
        )
        // Answered poll already keeps same-leg PiP; match that for Open CRM during ring→answer.
        if (!sameLegMinimized) {
          isMinimizedRef.current = false
          setIsMinimized(false)
          bumpOpenDismissGuard()
        }
        setCurrent((prev) => {
          if (prev?.id.startsWith("ring-") && phoneDigitsKey(prev.from_number) === phoneDigitsKey(row.from_number)) {
            ringAliasRef.current = prev.id
            dismissedRef.current.delete(prev.id)
          }
          return {
            ...row,
            caller_name: row.caller_name ?? prev?.caller_name ?? null,
            routed_to_name: payload.routed_to_name ?? prev?.routed_to_name ?? null,
          }
        })
      })
    }

    const onCompleted = (payload: OwnerCallCompletedPayload) => {
      const callSid = String(payload.call_sid ?? "").trim()
      const matchesOpenRow = (row: ActiveCallRow) =>
        callRowMatchesHangup(row, payload) ||
        (Boolean(callSid) && ringAliasRef.current === `ring-${callSid}`)

      const openManual = manualCallRowRef.current
      if (openManual && matchesOpenRow(openManual)) {
        // Manual panels stay open with Ended chrome.
        patchManualCallRow(applyCallEndedPatch(openManual, payload))
        return
      }

      setCurrent((prev) => {
        if (prev && matchesOpenRow(prev)) {
          // Stale RINGING / hold waiters — close; live Answer keeps post-call intake.
          if (shouldAutoDismissIntakeOnCallCompleted(prev, payload)) {
            const ids = [prev.id, ringAliasRef.current].filter((id): id is string => Boolean(id))
            markAnsweredIntakeDismissed(ownerUserId, ids)
            for (const id of ids) dismissedRef.current.add(id)
            ringAliasRef.current = null
            return null
          }
          return applyCallEndedPatch(prev, payload)
        }
        // Fallback: open intake for answered legs that missed call-answered (existing behavior).
        const row = rowFromCompletedPayload(payload)
        if (!row) return prev
        if (dismissedRef.current.has(row.id)) return prev
        if (prev && isIntakeCallActive(prev)) return prev
        return row
      })
    }

    const onRecordingReady = (payload: OwnerCallRecordingReadyPayload) => {
      const callLogId = String(payload.call_log_id ?? "").trim()
      const url = String(payload.recording_url ?? "").trim()
      if (!callLogId || !url) return

      setCurrent((prev) => {
        if (!prev || prev.id !== callLogId) return prev
        if (dismissedRef.current.has(callLogId)) return prev
        return { ...prev, recording_url: url }
      })

      if (manualCallRowRef.current?.id === callLogId) {
        patchManualCallRow({ recording_url: url })
      }
    }

    const onLiveGps = (raw: Record<string, unknown>) => {
      const callLogId = raw.call_log_id != null ? String(raw.call_log_id).trim() : ""
      const activeId = effectiveCurrentIdRef.current
      if (callLogId && activeId && callLogId !== activeId) return
      const lat = Number(raw.latitude)
      const lng = Number(raw.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      // Do not clobber address while typing elsewhere, in the address box, or after a manual edit.
      if (shouldSkipLiveGpsAddressUpdate(addressManuallyEditedRef.current)) return
      const formatted =
        (raw.formatted_address != null ? String(raw.formatted_address).trim() : "") ||
        `Live GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      setServiceAddressRef.current({
        formatted,
        street_number: "",
        route: formatted,
        locality: "",
        postal_code: "",
        admin_area: "",
        lat,
        lng,
      })
      // Best-effort reverse lookup to fill street/city/ZIP into the address field.
      geocodeAbortControllerRef.current?.abort()
      const controller = new AbortController()
      geocodeAbortControllerRef.current = controller
      void fetch(
        `/api/geocode/autocomplete?q=${encodeURIComponent(`${lat},${lng}`)}`,
        { signal: controller.signal }
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { suggestions?: Array<{ formatted?: string; street_number?: string; route?: string; locality?: string; postal_code?: string; admin_area?: string; lat?: number; lng?: number }> } | null) => {
          if (controller.signal.aborted) return
          const s = data?.suggestions?.[0]
          if (!s?.formatted) return
          // Reverse geocode can finish after they started typing or locked an address.
          if (shouldSkipLiveGpsAddressUpdate(addressManuallyEditedRef.current)) return
          setServiceAddressRef.current({
            formatted: s.formatted,
            street_number: s.street_number || "",
            route: s.route || s.formatted,
            locality: s.locality || "",
            postal_code: s.postal_code || "",
            admin_area: s.admin_area || "",
            lat: s.lat ?? lat,
            lng: s.lng ?? lng,
          })
          window.setTimeout(() => {
            // Only nudge focus when still idle (not typing elsewhere / in address / locked).
            if (shouldSkipLiveGpsAddressUpdate(addressManuallyEditedRef.current)) return
            addressSearchRef.current?.focus()
          }, 50)
        })
        .catch((err: unknown) => {
          // Stale GPS ping cancelled — ignore AbortError.
          // Never call .focus() here — a failed geocode must not steal the caret.
          if (
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError") ||
            (typeof err === "object" &&
              err !== null &&
              "name" in err &&
              (err as { name: string }).name === "AbortError")
          ) {
            return
          }
        })
    }

    // Customer uploaded a job photo / completed intake-rescue — refresh gallery + autofill.
    const onTicketPhotosUpdated = (raw: Record<string, unknown>) => {
      const callLogId = raw.call_log_id != null ? String(raw.call_log_id).trim() : ""
      const activeId = effectiveCurrentIdRef.current
      // Ignore photos for a different ticket when we know both ids.
      if (callLogId && activeId && !activeId.startsWith("ring-") && callLogId !== activeId) return
      const list = Array.isArray(raw.photos) ? raw.photos : []
      const mapped: IntakeJobPhoto[] = []
      for (const item of list) {
        if (!item || typeof item !== "object") continue
        const row = item as Record<string, unknown>
        const id = row.id != null ? String(row.id) : ""
        const url = row.url != null ? String(row.url) : ""
        if (!id || !url) continue
        const categoryRaw = row.category != null ? String(row.category) : "damage"
        const category =
          categoryRaw === "id_verification" || categoryRaw === "other"
            ? categoryRaw
            : ("damage" as const)
        mapped.push({
          id,
          url,
          mime_type: row.mime_type != null ? String(row.mime_type) : undefined,
          created_at: row.created_at != null ? String(row.created_at) : undefined,
          category,
        })
      }
      if (mapped.length) {
        setJobPhotosRef.current(mapped)
      } else {
        // Single-photo payloads still update the gallery.
        const single = raw.photo && typeof raw.photo === "object" ? (raw.photo as Record<string, unknown>) : null
        if (single?.id && single?.url) {
          const catRaw = single.category != null ? String(single.category) : "damage"
          const next: IntakeJobPhoto = {
            id: String(single.id),
            url: String(single.url),
            mime_type: single.mime_type != null ? String(single.mime_type) : undefined,
            created_at: single.created_at != null ? String(single.created_at) : undefined,
            category:
              catRaw === "id_verification" || catRaw === "other"
                ? catRaw
                : "damage",
          }
          setJobPhotosRef.current((prev) => {
            if (prev.some((p) => p.id === next.id)) return prev
            return [...prev, next]
          })
        }
      }

      // Full rescue package — autofill name + vehicle into the open intake form.
      const rescue =
        raw.rescue && typeof raw.rescue === "object"
          ? (raw.rescue as { token?: Record<string, unknown> })
          : null
      const tokenRow = rescue?.token && typeof rescue.token === "object" ? rescue.token : null
      if (tokenRow || raw.ticket_status === "info_received") {
        const meta: IntakeRescueMeta = {
          ticket_status:
            (tokenRow?.ticket_status != null
              ? String(tokenRow.ticket_status)
              : raw.ticket_status != null
                ? String(raw.ticket_status)
                : null) || "info_received",
          customer_name: tokenRow?.customer_name != null ? String(tokenRow.customer_name) : null,
          vehicle_vin: tokenRow?.vehicle_vin != null ? String(tokenRow.vehicle_vin) : null,
          vehicle_year: tokenRow?.vehicle_year != null ? String(tokenRow.vehicle_year) : null,
          vehicle_make: tokenRow?.vehicle_make != null ? String(tokenRow.vehicle_make) : null,
          vehicle_model: tokenRow?.vehicle_model != null ? String(tokenRow.vehicle_model) : null,
          vehicle_trim: tokenRow?.vehicle_trim != null ? String(tokenRow.vehicle_trim) : null,
          special_notes: tokenRow?.special_notes != null ? String(tokenRow.special_notes) : null,
          verify_on_arrival: Boolean(
            tokenRow?.verify_on_arrival ?? raw.verify_on_arrival
          ),
          vin_unavailable: Boolean(tokenRow?.vin_unavailable),
        }
        setRescueMetaRef.current(meta)
        if (meta.customer_name?.trim()) {
          patchFormRef.current({ displayName: meta.customer_name.trim() })
        }
        if (meta.vehicle_year || meta.vehicle_make || meta.vehicle_model) {
          setVehicleRef.current({
            vehicle_year: meta.vehicle_year || "",
            vehicle_make: meta.vehicle_make || "",
            vehicle_model: meta.vehicle_model || "",
          })
        }
        if (meta.vehicle_trim?.trim()) {
          patchFormRef.current({ vehicleTrim: meta.vehicle_trim.trim() })
        }
        if (meta.special_notes?.trim() && !formNotesRef.current.trim()) {
          patchFormRef.current({ notes: meta.special_notes.trim() })
        }
      }
    }

    for (const channel of channels) {
      channel.bind("call-initiated", onInitiated)
      channel.bind("call-answered", onAnswered)
      channel.bind("call-completed", onCompleted)
      channel.bind("call-recording-ready", onRecordingReady)
      channel.bind("live-gps", onLiveGps)
      channel.bind("ticket.photos_updated", onTicketPhotosUpdated)
    }
    return () => {
      cancelled = true
      stopRingingFastPoll()
      window.clearInterval(pollId)
      for (const timer of lookupTimers) window.clearTimeout(timer)
      for (const channel of channels) {
        channel.unbind("call-initiated", onInitiated)
        channel.unbind("call-answered", onAnswered)
        channel.unbind("call-completed", onCompleted)
        channel.unbind("call-recording-ready", onRecordingReady)
        channel.unbind("live-gps", onLiveGps)
        channel.unbind("ticket.photos_updated", onTicketPhotosUpdated)
        pusher.unsubscribe(channel.name)
      }
    }
  }, [enabled, ownerUserId, patchManualCallRow])

  // Global Dynamic Island tap — re-open intake for the engine's primary call.
  useEffect(() => {
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<LyncFocusIntakeDetail>).detail
      // Allow deep links that only have a call_log id (photo-upload SMS / toast).
      if (!detail?.fromNumber && !detail?.callLogId) return
      const callLogId = detail.callLogId?.trim() || ""
      const id = callLogId || (detail.callSid ? `ring-${detail.callSid}` : "")
      if (!id) return
      dismissedRef.current.delete(id)
      if (callLogId) dismissedRef.current.delete(callLogId)
      if (detail.callSid) dismissedRef.current.delete(`ring-${detail.callSid}`)
      const row: ActiveCallRow = {
        id: callLogId || id,
        from_number: detail.fromNumber || "",
        to_number: detail.toNumber || "",
        caller_name: null,
        answered_at: detail.phase === "connected" ? detail.answeredAt ?? new Date().toISOString() : null,
      }
      showCallRow(setCurrent, row, dismissedRef.current)
      isMinimizedRef.current = false
      setIsMinimized(false)
    }
    window.addEventListener(LYNCR_FOCUS_INTAKE_EVENT, onFocus)
    return () => window.removeEventListener(LYNCR_FOCUS_INTAKE_EVENT, onFocus)
  }, [])

  useEffect(() => {
    if (!enabled) setCurrent(null)
  }, [enabled])

  const dismissCallIntake = useCallback(
    (row: ActiveCallRow | null) => {
      if (!row || !ownerUserId) return
      const ids = [row.id, ringAliasRef.current].filter((id): id is string => Boolean(id))
      markAnsweredIntakeDismissed(ownerUserId, ids)
      for (const id of ids) dismissedRef.current.add(id)
      ringAliasRef.current = null
    },
    [ownerUserId]
  )

  /** Same queue advance the X dismiss uses — ringing first, then next answered leg. */
  const advanceToNextQueuedCall = useCallback((closedId: string) => {
    void fetchFirstUnseenRingingCall(dismissedRef.current).then((ringing) => {
      if (ringing) {
        showCallRow(setCurrent, ringing, dismissedRef.current)
        return
      }
      void fetchFirstUnseenAnsweredCall(dismissedRef.current).then((row) => {
        if (!row || row.id === closedId) return
        showCallRow(setCurrent, row, dismissedRef.current)
      })
    })
  }, [])

  const dismissOnly = useCallback(() => {
    setIsMinimized(false)
    setSecondaryIncoming(null)
    if (manualCallRow) {
      clearManualCallRow()
      setLostLeadState("idle")
      setLostLeadError(null)
      return
    }
    if (!current) return
    dismissCallIntake(current)
    const closedId = current.id
    setCurrent(null)
    advanceToNextQueuedCall(closedId)
  }, [advanceToNextQueuedCall, current, dismissCallIntake, manualCallRow, clearManualCallRow])

  const clearDraftForCurrentCaller = useCallback(() => {
    const phone = (form.phoneNumber.trim() || effectiveCurrent?.from_number || "").trim()
    if (isValidIntakeDraftPhone(phone)) clearIntakeDraft(phone)
    lastLoadedDraftPhoneRef.current = null
    dismissedDraftPhoneRef.current = null
    setPendingDraft(null)
  }, [form.phoneNumber, effectiveCurrent?.from_number])

  const resetIntakeUiState = useCallback(() => {
    resetForm()
    setCurrentStep("SERVICE_SELECT")
    setBookedLeadId(null)
    setConfirmSmsDraft(null)
    setConfirmSmsResolved(false)
    setCustomPrice("")
    setNegotiationDiscountApplied(null)
    setNegotiationDiscountsTried([])
    setFailureReason(FAILURE_REASON_NEUTRAL)
    setRecoveredViaRouteDiscount(false)
    setNegotiationStep(1)
    setLostLeadState("idle")
    setLostLeadError(null)
    setDraftPulse(false)
    setDraftRestoredFlash(false)
    setContinuingDraft(false)
    setPendingDraft(null)
    lastLoadedDraftPhoneRef.current = null
    dismissedDraftPhoneRef.current = null
  }, [resetForm])

  const dismissWithDraftClear = useCallback(() => {
    clearDraftForCurrentCaller()
    resetIntakeUiState()
    dismissOnly()
  }, [clearDraftForCurrentCaller, dismissOnly, resetIntakeUiState])

  /**
   * After a successful book / save / dispatch — same close + queue advance as the X button
   * so the next ringing/answered leg opens immediately.
   */
  const closeIntakeAfterSave = useCallback(() => {
    clearDraftForCurrentCaller()
    resetIntakeUiState()
    dismissOnly()
  }, [clearDraftForCurrentCaller, dismissOnly, resetIntakeUiState])

  const confirmAndBook = useCallback(async () => {
    if (!effectiveCurrent) return
    const userId = await resolveOwnerUserId()
    if (!userId) {
      setJobState("error")
      setJobError("Could not verify your account. Refresh the page and try again.")
      return
    }
    const quotedPriceCents = applyCustomPriceToForm()
    const result = await createJob(activeOrganizationId, jobCreateExtras(quotedPriceCents))
    if (!result.ok) return

    // Wipe the phone-keyed draft so the next call from this customer starts fresh.
    clearDraftForCurrentCaller()
    setBookedLeadId(result.leadId)
    setConfirmSmsDraft(result.customerSmsDraft?.trim() || null)
    setConfirmSmsResolved(!result.customerSmsDraft?.trim())
    setCurrentStep("BOOKING_COMPLETE")
  }, [
    activeOrganizationId,
    applyCustomPriceToForm,
    clearDraftForCurrentCaller,
    createJob,
    effectiveCurrent,
    jobCreateExtras,
    resolveOwnerUserId,
  ])

  const finishBookingAndOpenScheduler = useCallback(() => {
    if (confirmSmsDraft && !confirmSmsResolved) {
      toast({
        title: "Confirm the SMS first",
        description: "Send or skip the confirmation text before opening the scheduler.",
        variant: "destructive",
      })
      return
    }
    const leadId = bookedLeadId
    closeIntakeAfterSave()
    if (leadId) router.push(buildSchedulerFocusUrl(leadId))
  }, [
    bookedLeadId,
    closeIntakeAfterSave,
    confirmSmsDraft,
    confirmSmsResolved,
    router,
    toast,
  ])

  const dismissBookingComplete = useCallback(() => {
    if (confirmSmsDraft && !confirmSmsResolved) {
      toast({
        title: "Confirm the SMS first",
        description: "Send or skip the confirmation text before closing.",
        variant: "destructive",
      })
      return
    }
    dismissWithDraftClear()
  }, [confirmSmsDraft, confirmSmsResolved, dismissWithDraftClear, toast])

  const sendToDispatch = useCallback(async () => {
    if (!effectiveCurrent) return
    const userId = await resolveOwnerUserId()
    if (!userId) {
      setJobState("error")
      setJobError("Could not verify your account. Refresh the page and try again.")
      return
    }
    const quotedPriceCents = applyCustomPriceToForm()
    const result = await createJob(activeOrganizationId, jobCreateExtras(quotedPriceCents))
    if (!result.ok) return
    // Same confirm-SMS gate as Confirm & book (do not jump to scheduler with unreviewed text).
    clearDraftForCurrentCaller()
    setBookedLeadId(result.leadId)
    setConfirmSmsDraft(result.customerSmsDraft?.trim() || null)
    setConfirmSmsResolved(!result.customerSmsDraft?.trim())
    setCurrentStep("BOOKING_COMPLETE")
  }, [
    activeOrganizationId,
    applyCustomPriceToForm,
    clearDraftForCurrentCaller,
    createJob,
    effectiveCurrent,
    jobCreateExtras,
    resolveOwnerUserId,
  ])

  const savePendingLead = useCallback(async () => {
    if (!effectiveCurrent) return
    const userId = await resolveOwnerUserId()
    if (!userId) {
      setJobState("error")
      setJobError("Could not verify your account. Refresh the page and try again.")
      return
    }
    const quotedPriceCents = applyCustomPriceToForm()
    const result = await createJob(activeOrganizationId, {
      pendingCallback: true,
      ...jobCreateExtras(quotedPriceCents),
    })
    if (!result.ok) return
    closeIntakeAfterSave()
    // Pending callbacks live in CRM Leads tab (legacy /dashboard/leads board removed).
    router.push("/dashboard/customers?tab=leads")
  }, [
    activeOrganizationId,
    applyCustomPriceToForm,
    closeIntakeAfterSave,
    createJob,
    effectiveCurrent,
    jobCreateExtras,
    resolveOwnerUserId,
    router,
  ])

  /**
   * Save phone + quoted price + vehicle as a CRM quote lead without name / address / schedule.
   * Used when the customer hangs up after pricing and may call back later.
   */
  const saveQuoteLead = useCallback(async () => {
    if (!effectiveCurrent) return
    if (!canSaveQuoteLead) {
      setJobState("error")
      setJobError("Need a valid phone number to save a quote lead for call-back matching.")
      return
    }
    const userId = await resolveOwnerUserId()
    if (!userId) {
      setJobState("error")
      setJobError("Could not verify your account. Refresh the page and try again.")
      return
    }
    const quotedPriceCents = applyCustomPriceToForm()
    const result = await createJob(activeOrganizationId, {
      pendingCallback: true,
      quoteLead: true,
      ...jobCreateExtras(quotedPriceCents),
    })
    if (!result.ok) return
    const shop = form.serviceVenue === "shop"
    toast({
      title: shop ? "Shop quote saved" : "Quote lead saved",
      description: shop
        ? "Phone, vehicle, shop price, and notes saved. When they call back, match by this number under Leads."
        : "If they call back, this phone number will match the quoted price and vehicle.",
    })
    closeIntakeAfterSave()
    // Quote leads show under CRM → Leads (not the removed Leads Dashboard).
    router.push("/dashboard/customers?tab=leads")
  }, [
    activeOrganizationId,
    applyCustomPriceToForm,
    canSaveQuoteLead,
    closeIntakeAfterSave,
    createJob,
    effectiveCurrent,
    form.serviceVenue,
    jobCreateExtras,
    resolveOwnerUserId,
    router,
    toast,
  ])

  const setManualCallStatus = useCallback(
    (status: ManualCallStatus) => {
      patchManualCallRow({
        manualCallStatus: status,
        answered_at: status === "ringing" ? null : effectiveCurrent?.answered_at ?? new Date().toISOString(),
        // Manual "Completed" mirrors carrier hangup chrome.
        ended_at: status === "completed" ? new Date().toISOString() : null,
      })
    },
    [effectiveCurrent?.answered_at, patchManualCallRow]
  )

  const handleManualServiceTypeChange = useCallback(
    (serviceType: ServiceQuoteTypeId) => {
      // Gate: known returning callers must choose Restore / Continue / View / New first.
      if (!callbackChooserDismissed) {
        const phone = (form.phoneNumber || effectiveCurrent?.from_number || "")
          .replace(/\D/g, "")
          .slice(-10)
        const enginePhone =
          lyncEngine?.primaryCall?.fromNumber.replace(/\D/g, "").slice(-10) ?? ""
        const hasActiveJob =
          Boolean(phone) &&
          enginePhone === phone &&
          lyncEngine?.primaryCall?.callerContext?.kind === "active_job"
        const known = isKnownReturningCaller({
          hasMatchedCustomer: Boolean(matchedCustomer),
          hasPendingDraft: Boolean(pendingDraft),
          openLeadId: crmOpenLeadId,
          garageVehicleCount: garageVehicles.length,
          activeJobId: hasActiveJob
            ? lyncEngine?.primaryCall?.callerContext?.kind === "active_job"
              ? lyncEngine.primaryCall.callerContext.jobId
              : null
            : null,
        })
        if (known) {
          toast({
            title: "Pick what this call is about",
            description: "Restore draft, Continue quote, View job, or New job — then choose a service.",
          })
          return
        }
      }
      setVehicleLockoutIntake(false)
      setShowMoreJobTypes(false)
      setKeySkipArmed(false)
      setServiceQuoteTypeId(serviceType)
      setCurrentStep(manualIntakeStepAfterService(serviceType))
    },
    [
      callbackChooserDismissed,
      crmOpenLeadId,
      effectiveCurrent?.from_number,
      form.phoneNumber,
      garageVehicles.length,
      lyncEngine?.primaryCall,
      matchedCustomer,
      pendingDraft,
      setServiceQuoteTypeId,
      toast,
    ]
  )

  /** JOB_TYPE step — copy vs AKL (etc.) before YMM; then vehicle fields. */
  const handleJobTypeChange = useCallback(
    (serviceType: ServiceQuoteTypeId) => {
      setKeySkipArmed(false)
      setServiceQuoteTypeId(serviceType)
      setCurrentStep("VEHICLE_INFO")
    },
    [setServiceQuoteTypeId]
  )

  /** One-tap price shopping — saves to lost_leads / salvage without extra dropdown fuss. */
  const markPriceShopping = useCallback(async () => {
    setFailureReason("Price shopping")
    // Small delay so state commits before the lost-lead POST reads failureReason
    await new Promise((r) => window.setTimeout(r, 0))
    setLostLeadState("saving")
    setLostLeadError(null)
    if (!effectiveCurrent || !ownerUserId) {
      setLostLeadState("error")
      setLostLeadError("Need an active call to log price shopping")
      return
    }
    try {
      const quotedPriceCents = resolveLostLeadQuoteCents()
      const res = await fetch("/api/leads/lost", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_log_id:
            effectiveCurrent.sourceCallLogId?.trim() ||
            (effectiveCurrent.isManual ? null : effectiveCurrent.id),
          phone_number: form.phoneNumber.trim() || effectiveCurrent.from_number,
          last_quoted_price_cents: quotedPriceCents,
          baseline_quote_cents: liveQuote.totalCents > 0 ? liveQuote.totalCents : null,
          discount_applied: negotiationDiscountApplied,
          negotiation_discounts_tried: negotiationDiscountsTried,
          failure_reason: "Price shopping",
          vehicle_year: form.vehicleYear,
          vehicle_make: form.vehicleMake,
          vehicle_model: form.vehicleModel,
          service_type: liveQuote.dispatchJobTypeLabel,
          organization_id: activeOrganizationId,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log price shopping")
      setLostLeadState("saved")
      toast({
        title: "Logged as price shopping",
        description: "Saved for follow-up when they call back.",
      })
      void revalidateSchedulerJobPoolCaches(activeOrganizationId)
      window.setTimeout(() => dismissOnly(), 900)
    } catch (e) {
      setLostLeadState("error")
      setLostLeadError(e instanceof Error ? e.message : "Could not log price shopping")
    }
  }, [
    activeOrganizationId,
    dismissOnly,
    effectiveCurrent,
    form.phoneNumber,
    form.vehicleMake,
    form.vehicleModel,
    form.vehicleYear,
    liveQuote.dispatchJobTypeLabel,
    liveQuote.totalCents,
    negotiationDiscountApplied,
    negotiationDiscountsTried,
    ownerUserId,
    resolveLostLeadQuoteCents,
    toast,
  ])

  /** Opens the shared fee-options sheet (No fee / $49 / Full quote → SMS). */
  const openIntakeBookingLink = useCallback(() => {
    const phone =
      resolvedPhoneNumber || form.phoneNumber || effectiveCurrent?.from_number || ""
    if (!phone.trim()) {
      toast({
        title: "Need a phone number",
        description: "Enter the caller phone before texting a booking link.",
        variant: "destructive",
      })
      return
    }
    setBookingLinkOpen(true)
  }, [
    effectiveCurrent?.from_number,
    form.phoneNumber,
    resolvedPhoneNumber,
    toast,
  ])

  /**
   * Save quote lead (if possible) + text $49 service-call form+pay link.
   * Customer fills dispatch fields, then pays via Stripe.
   */
  const sendServiceCallFeeLink = useCallback(async () => {
    const phone =
      resolvedPhoneNumber || form.phoneNumber || effectiveCurrent?.from_number || ""
    if (!phone.trim()) {
      toast({
        title: "Need a phone number",
        description: "Enter the caller phone before sending the $49 link.",
        variant: "destructive",
      })
      return
    }
    setServiceCallLinkBusy(true)
    try {
      // Prefer tying the pay link to a saved quote lead when we have enough to create one
      let jobId: string | null = bookedLeadId
      if (!jobId && canSaveQuoteLead) {
        const quotedPriceCents = applyCustomPriceToForm()
        const result = await createJob(activeOrganizationId, {
          pendingCallback: true,
          quoteLead: true,
          ...jobCreateExtras(quotedPriceCents),
        })
        if (result.ok) jobId = result.leadId
      }

      const res = await fetch("/api/payments/service-call-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: jobId || undefined,
          phone,
          customerName: form.displayName.trim() || undefined,
          note: "Service call fee ($49) — after pay, tech can be on the way",
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { form_url?: string }
      }
      if (!res.ok) {
        toast({
          title: "Could not send $49 link",
          description: json.error || "Check Stripe Connect / SMS setup.",
          variant: "destructive",
        })
        return
      }
      toast({
        title: "$49 service call link sent",
        description: "Customer fills a short form, then pays $49.",
      })
      if (jobId) closeIntakeAfterSave()
    } finally {
      setServiceCallLinkBusy(false)
    }
  }, [
    activeOrganizationId,
    applyCustomPriceToForm,
    bookedLeadId,
    canSaveQuoteLead,
    closeIntakeAfterSave,
    createJob,
    effectiveCurrent?.from_number,
    form.displayName,
    form.phoneNumber,
    jobCreateExtras,
    resolvedPhoneNumber,
    toast,
  ])

  const requestLiveGps = useCallback(async () => {
    const phone = resolvedPhoneNumber || form.phoneNumber || effectiveCurrent?.from_number || ""
    if (!phone.trim()) {
      toast({ title: "Need a phone number", description: "Enter the caller phone first." })
      return
    }
    setGpsRequestState("sending")
    try {
      const res = await fetch("/api/intake/request-gps", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          call_log_id: effectiveCurrent?.id ?? null,
          organization_id: activeOrganizationId ?? null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setGpsRequestState("error")
        toast({
          title: "GPS text failed",
          description: json.error || "Could not send locate link.",
          variant: "destructive",
        })
        return
      }
      setGpsRequestState("sent")
      toast({
        title: "Locate link texted",
        description: "When they tap Allow, their pin drops into the address field.",
      })
    } catch {
      setGpsRequestState("error")
      toast({ title: "GPS text failed", description: "Network error.", variant: "destructive" })
    }
  }, [
    activeOrganizationId,
    effectiveCurrent?.from_number,
    effectiveCurrent?.id,
    form.phoneNumber,
    resolvedPhoneNumber,
    toast,
  ])

  const handleManualVehicleChange = useCallback(
    (vehicle: { vehicle_year: string; vehicle_make: string; vehicle_model: string }) => {
      setPreloadedKeyBundle(null)
      setVehicle(vehicle)
      if (vehicle.vehicle_model.trim()) {
        const activeType = (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId
        setCurrentStep(nextStepAfterVehicleInfo(activeType, vehicleLockoutIntake))
      }
    },
    [form.serviceQuoteTypeId, setVehicle, vehicleLockoutIntake]
  )

  const handleManualKeyVariantSelected = useCallback(
    (selection: VehicleKeySelection) => {
      setKeySkipArmed(false)
      setVehicleKeySelection(selection)
      // Stay on key step when out-of-stock / specialty alternatives apply.
      const stockBlock = shouldShowOutOfStockFallback(preloadedKeyBundle?.inventory)
      if (stockBlock.show) return
      requestAnimationFrame(() => setCurrentStep("ADDRESS_CONTACT"))
    },
    [preloadedKeyBundle?.inventory, setVehicleKeySelection]
  )

  /** FCC field / Fast Lookup got a 17-digit VIN — fill YMM + optional preloaded key specs. */
  const handleVehicleFromVin = useCallback(
    (decoded: {
      year: string
      make: string
      model: string
      trim?: string
      vin: string
      keyBundle?: PreloadedVehicleKeyBundle | null
    }) => {
      setVehicle({
        vehicle_year: decoded.year,
        vehicle_make: decoded.make,
        vehicle_model: decoded.model,
      })
      patchForm({
        vehicleVin: decoded.vin,
        ...(decoded.trim ? { vehicleTrim: decoded.trim } : {}),
      })
      if (decoded.keyBundle) setPreloadedKeyBundle(decoded.keyBundle)
      else setPreloadedKeyBundle(null)
      if (decoded.model.trim()) {
        const activeType = (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId
        setCurrentStep(nextStepAfterVehicleInfo(activeType, vehicleLockoutIntake))
      }
    },
    [form.serviceQuoteTypeId, setVehicle, patchForm, vehicleLockoutIntake]
  )

  const handleManualAddressChange = useCallback(
    (addr: StructuredAddress | null) => {
      // Operator picked or cleared via autocomplete — lock out further live-GPS overwrites.
      addressManuallyEditedRef.current = true
      setServiceAddress(addr)
    },
    [setServiceAddress]
  )

  const handleAddressQueryCommit = useCallback(
    (query: string) => {
      // Free-typed / pasted address on blur — treat as a manual entry.
      addressManuallyEditedRef.current = true
      commitAddressQuery(query)
    },
    [commitAddressQuery]
  )

  const goBackManualWorkflow = useCallback(
    (path: WorkflowStep[]) => {
      const prev = previousWorkflowStep(path, currentStep)
      if (prev) setCurrentStep(prev)
    },
    [currentStep]
  )

  // Active/recent job from the same engine context that powers RECENT JOB ACTIVE.
  const activeCallbackJobId = useMemo(() => {
    const phone = (form.phoneNumber || effectiveCurrent?.from_number || "").replace(/\D/g, "").slice(-10)
    if (!phone || !lyncEngine?.primaryCall) return null
    const enginePhone = lyncEngine.primaryCall.fromNumber.replace(/\D/g, "").slice(-10)
    if (enginePhone !== phone) return null
    const ctx = lyncEngine.primaryCall.callerContext
    return ctx?.kind === "active_job" ? ctx.jobId : null
  }, [effectiveCurrent?.from_number, form.phoneNumber, lyncEngine?.primaryCall])

  // Empty string = open-quote cleared Lockout; path still needs a concrete id for branch shape.
  const serviceTypeId = (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId
  const selectorServiceTypeId = (form.serviceQuoteTypeId.trim()
    ? form.serviceQuoteTypeId
    : "") as ServiceQuoteTypeId | ""
  const manualPath = useMemo(
    () => manualWorkflowPath(serviceTypeId, vehicleLockoutIntake),
    [serviceTypeId, vehicleLockoutIntake]
  )
  const knownReturningCaller = isKnownReturningCaller({
    hasMatchedCustomer: Boolean(matchedCustomer),
    hasPendingDraft: Boolean(pendingDraft),
    openLeadId: crmOpenLeadId,
    garageVehicleCount: garageVehicles.length,
    activeJobId: activeCallbackJobId,
  })
  // Decision card first — hide Service wizard until intent is chosen.
  const showReturningCallerCard =
    !callbackChooserDismissed &&
    currentStep === "SERVICE_SELECT" &&
    knownReturningCaller
  const incomingPhone = form.phoneNumber || effectiveCurrent?.from_number || ""
  const repeatUrgency = useRepeatCallerUrgency(incomingPhone, effectiveCurrent?.id ?? null)
  /** New inbound / legacy draft → Restore secondary; same call leg crash → Restore primary. */
  const restoreDraftSecondary = useMemo(() => {
    if (!pendingDraft) return true
    return isIntakeDraftRestoreSecondary(
      pendingDraft,
      effectiveCurrent?.sourceCallLogId?.trim() || effectiveCurrent?.id || null
    )
  }, [pendingDraft, effectiveCurrent?.id, effectiveCurrent?.sourceCallLogId])
  const returningCallerVehicleLabels = useMemo(() => {
    const labels: string[] = []
    const seen = new Set<string>()
    const push = (label: string | null) => {
      const t = label?.trim()
      if (!t) return
      const key = t.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      labels.push(t)
    }
    push(
      formatReturningCallerVehicleFact({
        year: form.vehicleYear,
        make: form.vehicleMake,
        model: form.vehicleModel,
      })
    )
    for (const v of garageVehicles) {
      push(
        formatReturningCallerVehicleFact({
          year: v.year,
          make: v.make,
          model: v.model,
        })
      )
    }
    return labels.slice(0, 4)
  }, [form.vehicleMake, form.vehicleModel, form.vehicleYear, garageVehicles])
  const returningCallerNotes = useMemo(
    () =>
      summarizeReturningCallerNotes(
        matchedCustomer?.notes,
        returningCallerNotesExpanded ? 400 : 72
      ),
    [matchedCustomer?.notes, returningCallerNotesExpanded]
  )
  const returningCallerServiceLabel = useMemo(() => {
    const id = (crmOpenLeadServiceTypeId || form.serviceQuoteTypeId || "").trim()
    if (!id) return null
    return SERVICE_QUOTE_TYPES.find((s) => s.id === id)?.label ?? null
  }, [crmOpenLeadServiceTypeId, form.serviceQuoteTypeId])
  const activeCallbackJobMeta = useMemo(() => {
    const ctx = lyncEngine?.primaryCall?.callerContext
    if (ctx?.kind !== "active_job") return null
    return ctx.vehicleLabel || ctx.customerName || null
  }, [lyncEngine?.primaryCall?.callerContext])
  const returningCallerLastJob = useMemo(
    () => pickReturningCallerLastJob(crmServiceHistory),
    [crmServiceHistory]
  )
  const returningCallerLastJobLine = useMemo(
    () =>
      returningCallerLastJob
        ? formatReturningCallerHistoryLine(returningCallerLastJob)
        : null,
    [returningCallerLastJob]
  )
  const returningCallerLastJobAddress = useMemo(() => {
    const fromJob = returningCallerLastJob?.address_line1?.trim() || ""
    return fromJob || null
  }, [returningCallerLastJob])
  const returningCallerRecentHistory = useMemo(() => {
    const lines: string[] = []
    for (const item of crmServiceHistory) {
      if (item.is_open_lead) continue
      if (returningCallerLastJob && item.id === returningCallerLastJob.id) continue
      const line = formatReturningCallerHistoryLine(item)
      if (!line.trim()) continue
      lines.push(line)
      if (lines.length >= 3) break
    }
    return lines
  }, [crmServiceHistory, returningCallerLastJob])
  const returningCallerAddressLine = useMemo(() => {
    // Prefer job street from the open book-form / lead (form seed), then CRM profile.
    const fromForm = form.addressLine1.trim()
    if (fromForm) return fromForm
    if (!matchedCustomer) return null
    const parts = [
      matchedCustomer.address_line1?.trim(),
      matchedCustomer.city?.trim(),
      matchedCustomer.region?.trim(),
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(", ") : null
  }, [form.addressLine1, matchedCustomer])
  const fromBookFormOpen = Boolean(manualCallRow?.fromBookForm)
  const returningCallerLastPaidLine = useMemo(() => {
    const paid = crmPayments.find((p) => p.status === "COMPLETED")
    if (!paid) return null
    const amountCents = Math.round(paid.amount * 100)
    const when = formatReturningCallerHistoryDate(paid.createdAt)
    return `Last paid ${formatCollectedDollars(amountCents)}${when ? ` · ${when}` : ""}`
  }, [crmPayments])
  const returningCallerLifetimeLine = useMemo(() => {
    const fromProfile =
      crmLifetimeRevenueCents != null && crmLifetimeRevenueCents > 0
        ? crmLifetimeRevenueCents
        : null
    const fromPayments =
      fromProfile == null
        ? Math.round(
            crmPayments
              .filter((p) => p.status === "COMPLETED")
              .reduce((sum, p) => sum + p.amount * 100, 0)
          )
        : null
    const cents = fromProfile ?? (fromPayments != null && fromPayments > 0 ? fromPayments : null)
    if (cents == null || cents <= 0) return null
    return `Lifetime ${formatCollectedDollars(cents)}`
  }, [crmLifetimeRevenueCents, crmPayments])
  const returningCallerRecentCallLine = useMemo(() => {
    if (!repeatUrgency.isHighUrgency || repeatUrgency.minutesSinceLastMissed == null) {
      return null
    }
    return formatRepeatCallerHistoryLine(repeatUrgency.minutesSinceLastMissed)
  }, [repeatUrgency.isHighUrgency, repeatUrgency.minutesSinceLastMissed])
  const returningCallerHasCrmHistory = Boolean(
    matchedCustomer ||
      crmOpenLeadId ||
      garageVehicles.length > 0 ||
      activeCallbackJobId ||
      crmServiceHistory.length > 0 ||
      crmPayments.length > 0
  )
  const returningCallerPrimary = useMemo(() => {
    if (activeCallbackJobId) {
      return { label: "Continue last job", action: "view_job" as const }
    }
    if (hasContinueableOpenLead(crmOpenLeadId)) {
      const money =
        crmOpenLeadQuoteCents != null && crmOpenLeadQuoteCents > 0
          ? ` · ${formatCrmQuoteChip(crmOpenLeadQuoteCents)}`
          : ""
      // Book-form Latest taps: “Book job” (prefilled) — form already submitted.
      return {
        label: fromBookFormOpen ? `Book job${money}` : `Continue quote${money}`,
        action: "continue_quote" as const,
      }
    }
    if (pendingDraft && !restoreDraftSecondary) {
      return { label: "Restore draft", action: "restore_draft" as const }
    }
    if (returningCallerLastJob?.id) {
      return { label: "Open last job", action: "open_last_job" as const }
    }
    if (pendingDraft) {
      return { label: "Restore draft", action: "restore_draft" as const }
    }
    return null
  }, [
    activeCallbackJobId,
    crmOpenLeadId,
    crmOpenLeadQuoteCents,
    fromBookFormOpen,
    pendingDraft,
    restoreDraftSecondary,
    returningCallerLastJob?.id,
  ])
  const isManual = Boolean(effectiveCurrent?.isManual)
  /** One step wizard for everyone — keeps negotiation / lost-lead / ops on the same path. */
  const stepIntake = true
  /**
   * Past Service: collapse Decline/SMS/booking + slim header so Vehicle / Location /
   * Schedule / Customer content (year grid, address) can dominate the sheet.
   */
  const compactIntakeChrome =
    stepIntake &&
    currentStep !== "SERVICE_SELECT" &&
    currentStep !== "BOOKING_COMPLETE"
  const vehicleYmmComplete = Boolean(
    form.vehicleYear.trim() && form.vehicleMake.trim() && form.vehicleModel.trim()
  )

  const canAdvanceFromLocation = useMemo(
    () =>
      Boolean(
        addressReady ||
          isFlatAddressReadyForDispatch({ addressLine1: form.addressLine1, city: form.city })
      ),
    [form.addressLine1, form.city, addressReady]
  )

  /** Schedule step — ASAP or a valid day From–To window (same as /book). */
  const canConfirmSchedule = useMemo(
    () => isIntakeSchedulePreferenceReady(form),
    [
      form.scheduleUrgency,
      form.scheduledDate,
      form.scheduledTime,
      form.availabilityFrom,
      form.availabilityTo,
    ]
  )

  const scheduleSummaryLabel = useMemo(
    () => formatIntakeScheduleSummary(form),
    [
      form.scheduleUrgency,
      form.scheduledDate,
      form.scheduledTime,
      form.availabilityFrom,
      form.availabilityTo,
    ]
  )

  const canFinalizeBooking = useMemo(
    () => Boolean(form.displayName.trim()),
    [form.displayName]
  )

  /** Explicit Continue button advances — no silent auto-jump past name/address. */

  /** Jump to top of the step panel whenever the workflow advances (mobile was stacking steps below). */
  useEffect(() => {
    manualStepScrollRef.current?.scrollTo({ top: 0, behavior: "instant" })
  }, [currentStep])

  const focusIntakePrimaryField = useCallback(() => {
    requestAnimationFrame(() => {
      if (stepIntake) {
        if (currentStep === "ADDRESS_CONTACT") {
          addressSearchRef.current?.focus()
          return
        }
        if (currentStep === "CUSTOMER_NAME") {
          document.getElementById("manual-ac-display")?.focus()
          return
        }
        if (currentStep === "SCHEDULE_TIME") {
          document.getElementById("intake-schedule-asap")?.focus()
          return
        }
        if (currentStep === "SERVICE_SELECT") {
          document.querySelector<HTMLElement>("[data-intake-primary-option]")?.focus()
          return
        }
      }
      const searchInput = document.querySelector<HTMLElement>("[data-intake-primary-search]")
      if (searchInput) {
        searchInput.focus()
        return
      }
      document.querySelector<HTMLElement>("[data-intake-primary-option]")?.focus()
    })
  }, [stepIntake, currentStep])

  /** Focus the primary search / first option whenever intake opens or advances. */
  useEffect(() => {
    if (!effectiveCurrent) return
    focusIntakePrimaryField()
  }, [effectiveCurrent?.id, currentStep, stepIntake, focusIntakePrimaryField])

  const armSheetDismissSuppress = useCallback((ms = 500) => {
    // Ignore Radix "close" from the same click that asked us to re-open (PiP tray).
    suppressSheetDismissRef.current = true
    if (suppressSheetDismissTimerRef.current) {
      window.clearTimeout(suppressSheetDismissTimerRef.current)
    }
    suppressSheetDismissTimerRef.current = window.setTimeout(() => {
      suppressSheetDismissRef.current = false
      suppressSheetDismissTimerRef.current = null
    }, ms)
  }, [])

  const minimizeIntake = useCallback(() => {
    isMinimizedRef.current = true
    setIsMinimized(true)
  }, [])

  /** Same focus path as CRM Open job — minimize intake so the drawer isn't buried. */
  const openActiveJobOnScheduler = useCallback(
    (jobId: string) => {
      const id = jobId.trim()
      if (!id) return
      setCallbackChooserDismissed(true)
      setContinuingDraft(false)
      // Remember Lines/Routing so drawer close can expand PiP again.
      intakeReturnTabRef.current = activeTab === "contacts" ? "dashboard" : activeTab
      minimizeIntake()
      // from=intake → Scheduler closeJobDrawer emits return-to-intake.
      router.push(buildSchedulerFocusUrl(id, { fromIntake: true }))
    },
    [activeTab, minimizeIntake, router]
  )

  const handleViewUpdateJob = useCallback(() => {
    if (!activeCallbackJobId) return
    openActiveJobOnScheduler(activeCallbackJobId)
  }, [activeCallbackJobId, openActiveJobOnScheduler])

  const handleOpenLastJobForReturningCaller = useCallback(() => {
    const id = returningCallerLastJob?.id?.trim()
    if (!id) return
    openActiveJobOnScheduler(id)
  }, [openActiveJobOnScheduler, returningCallerLastJob?.id])

  const handleOpenCrmForReturningCaller = useCallback(() => {
    const id = matchedCustomer?.id?.trim()
    if (!id) return
    // Peek CRM only — do not dismiss the decision card (that was opening New Intake).
    intakeReturnTabRef.current = activeTab === "contacts" ? "dashboard" : activeTab
    // Cancel any Map→intake expand so CRM stays on top with a PiP tray.
    pendingExpandAfterTabRef.current = null
    minimizeIntake()
    router.push(buildCrmReturnUrl(id))
  }, [activeTab, matchedCustomer?.id, minimizeIntake, router])

  const handleContinueOpenQuote = useCallback(() => {
    // Snapshot same-phone draft before we clear the Restore chip / pending state.
    const draft =
      pendingDraft &&
      activeDraftPhone &&
      intakeDraftBelongsToPhone(pendingDraft, activeDraftPhone)
        ? pendingDraft
        : null
    const draftForm = draft?.form

    // Draft fills gaps CRM does not have yet (YMM, address, time, name).
    const ymm = resolveOpenQuoteYmm({
      lead: {
        vehicle_year: draftForm?.vehicleYear || form.vehicleYear,
        vehicle_make: draftForm?.vehicleMake || form.vehicleMake,
        vehicle_model: draftForm?.vehicleModel || form.vehicleModel,
      },
      garage: garageVehicles[0] ?? null,
    })
    const mergedYear = form.vehicleYear.trim() || draftForm?.vehicleYear?.trim() || ymm.year
    const mergedMake = form.vehicleMake.trim() || draftForm?.vehicleMake?.trim() || ymm.make
    const mergedModel = form.vehicleModel.trim() || draftForm?.vehicleModel?.trim() || ymm.model
    const mergedAddress1 = form.addressLine1.trim() || draftForm?.addressLine1?.trim() || ""
    const mergedCity = form.city.trim() || draftForm?.city?.trim() || ""
    const mergedDate = form.scheduledDate.trim() || draftForm?.scheduledDate?.trim() || ""
    const mergedTime = form.scheduledTime.trim() || draftForm?.scheduledTime?.trim() || ""
    const mergedSchedule = normalizeIntakeScheduleFields({
      scheduleUrgency: form.scheduleUrgency || draftForm?.scheduleUrgency || "",
      scheduledDate: mergedDate,
      scheduledTime: mergedTime,
      availabilityFrom:
        form.availabilityFrom.trim() || draftForm?.availabilityFrom?.trim() || "",
      availabilityTo: form.availabilityTo.trim() || draftForm?.availabilityTo?.trim() || "",
    })
    const mergedAddressReady =
      addressReady ||
      isFlatAddressReadyForDispatch({
        addressLine1: mergedAddress1,
        city: mergedCity,
      })

    if (draftForm) {
      skipNextDraftSaveRef.current = true
      patchForm({
        displayName: form.displayName.trim() || draftForm.displayName,
        vehicleYear: mergedYear,
        vehicleMake: mergedMake,
        vehicleModel: mergedModel,
        addressLine1: mergedAddress1,
        addressLine2: form.addressLine2.trim() || draftForm.addressLine2,
        city: mergedCity,
        region: form.region.trim() || draftForm.region,
        postalCode: form.postalCode.trim() || draftForm.postalCode,
        serviceAddress: form.serviceAddress || draftForm.serviceAddress,
        scheduledDate: mergedSchedule.scheduledDate,
        scheduledTime: mergedSchedule.scheduledTime,
        scheduleUrgency: mergedSchedule.scheduleUrgency,
        availabilityFrom: mergedSchedule.availabilityFrom,
        availabilityTo: mergedSchedule.availabilityTo,
        notes: form.notes.trim() || draftForm.notes,
        jobType: form.jobType.trim() || draftForm.jobType,
      })
      if (draft.customPrice.trim() && !customPrice.trim()) {
        setCustomPrice(draft.customPrice)
      }
    }

    applyOpenQuoteContinuePrefill()
    setCallbackChooserDismissed(true)
    setCallbackForceNewJob(false)
    setContinuingDraft(Boolean(draft))
    // Hide Restore chip for this session so Continue quote isn't buried under it.
    if (activeDraftPhone) {
      dismissedDraftPhoneRef.current = normalizeIntakeDraftPhone(activeDraftPhone)
    }
    setPendingDraft(null)
    const serviceId = (crmOpenLeadServiceTypeId ||
      form.serviceQuoteTypeId ||
      "") as ServiceQuoteTypeId | ""
    // Prefill may set a non-lockout type — vehicle-lockout branch only for explicit lockout.
    if (serviceId && serviceId !== "lockout") {
      setVehicleLockoutIntake(false)
    }
    // CRM Book may precompute the landing step; otherwise skip filled fields.
    const next =
      manualCallRow?.continueOpenQuote && manualCallRow.intakeStartStep
        ? manualCallRow.intakeStartStep
        : continueOpenQuoteStep({
            serviceTypeId: serviceId,
            vehicleYear: mergedYear,
            vehicleMake: mergedMake,
            vehicleModel: mergedModel,
            addressReady: mergedAddressReady,
            displayName: form.displayName.trim() || draftForm?.displayName?.trim() || "",
            scheduledDate: mergedSchedule.scheduledDate,
            scheduledTime: mergedSchedule.scheduledTime,
            scheduleUrgency: mergedSchedule.scheduleUrgency,
            availabilityFrom: mergedSchedule.availabilityFrom,
            availabilityTo: mergedSchedule.availabilityTo,
          })
    setCurrentStep(next)
  }, [
    activeDraftPhone,
    addressReady,
    applyOpenQuoteContinuePrefill,
    crmOpenLeadServiceTypeId,
    customPrice,
    form.addressLine1,
    form.addressLine2,
    form.city,
    form.displayName,
    form.jobType,
    form.notes,
    form.postalCode,
    form.region,
    form.scheduledDate,
    form.scheduledTime,
    form.serviceAddress,
    form.serviceQuoteTypeId,
    form.vehicleMake,
    form.vehicleModel,
    form.vehicleYear,
    garageVehicles,
    manualCallRow?.continueOpenQuote,
    manualCallRow?.intakeStartStep,
    patchForm,
    pendingDraft,
  ])

  // CRM Book (thin quote) → auto Continue open quote once per handoff row.
  // Skip when intakeStartStep is missing AND service is still unknown (book-form race).
  const continueQuoteAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    const rowId = manualCallRow?.id?.trim() || null
    if (!manualCallRow?.continueOpenQuote || !rowId) {
      if (!rowId) continueQuoteAppliedRef.current = null
      return
    }
    if (!manualCallRow.existingLeadId?.trim()) return
    // Book-form / thin handoffs without a precomputed step wait for a real service id.
    const hasStep = Boolean(manualCallRow.intakeStartStep)
    const hasService = Boolean(
      (manualCallRow.serviceQuoteTypeId || crmOpenLeadServiceTypeId || form.serviceQuoteTypeId || "").trim()
    )
    if (!hasStep && !hasService) return
    if (continueQuoteAppliedRef.current === rowId) return
    continueQuoteAppliedRef.current = rowId
    handleContinueOpenQuote()
  }, [
    manualCallRow?.id,
    manualCallRow?.continueOpenQuote,
    manualCallRow?.existingLeadId,
    manualCallRow?.intakeStartStep,
    manualCallRow?.serviceQuoteTypeId,
    crmOpenLeadServiceTypeId,
    form.serviceQuoteTypeId,
    handleContinueOpenQuote,
  ])

  const handleReturningCallerPrimaryContinue = useCallback(() => {
    if (!returningCallerPrimary) return
    if (returningCallerPrimary.action === "view_job") {
      handleViewUpdateJob()
      return
    }
    if (returningCallerPrimary.action === "continue_quote") {
      handleContinueOpenQuote()
      return
    }
    if (returningCallerPrimary.action === "restore_draft") {
      restorePendingDraft()
      return
    }
    if (returningCallerPrimary.action === "open_last_job") {
      handleOpenLastJobForReturningCaller()
    }
  }, [
    handleContinueOpenQuote,
    handleOpenLastJobForReturningCaller,
    handleViewUpdateJob,
    restorePendingDraft,
    returningCallerPrimary,
  ])

  const handleNewJobForReturningCaller = useCallback(() => {
    // Clear pending draft so New job is not stuck in a Restore loop on the next open.
    if (activeDraftPhone) {
      clearIntakeDraft(activeDraftPhone)
      const normalized = normalizeIntakeDraftPhone(activeDraftPhone)
      dismissedDraftPhoneRef.current = normalized
      lastLoadedDraftPhoneRef.current = null
    }
    setPendingDraft(null)
    setContinuingDraft(false)
    startFreshJobForReturningCaller()
    setCallbackChooserDismissed(true)
    setCallbackForceNewJob(true)
    setVehicleLockoutIntake(false)
    setCurrentStep("SERVICE_SELECT")
  }, [activeDraftPhone, startFreshJobForReturningCaller])

  const expandIntake = useCallback(() => {
    // PiP tray expand — same-click outside dismiss still needs a short suppress.
    armSheetDismissSuppress()
    isMinimizedRef.current = false
    setIsMinimized(false)
  }, [armSheetDismissSuppress])

  /** Open the sheet once routing has left Map (activeTab matches the restore target). */
  const expandIntakeAfterTabReady = useCallback(() => {
    pendingExpandAfterTabRef.current = null
    isMinimizedRef.current = false
    setIsMinimized(false)
  }, [])

  /**
   * Leave Map, restore prior tab, then re-open intake.
   * Sheet open is driven by activeTab — not setTimeout / rAF — so routing and dismiss stay decoupled.
   */
  const returnToIntakeFromMap = useCallback(() => {
    const target = intakeReturnTabRef.current || "dashboard"
    // Already on the restore tab — open immediately (no navigation race).
    if (activeTab === target) {
      expandIntakeAfterTabReady()
      return
    }
    // Stay minimized until the URL/tab switch lands, then expand in the effect below.
    pendingExpandAfterTabRef.current = target
    isMinimizedRef.current = true
    setIsMinimized(true)
    setActiveTab(target)
  }, [activeTab, expandIntakeAfterTabReady, setActiveTab])

  // When router/presence updates activeTab to the pending restore tab, open the sheet.
  useEffect(() => {
    const pending = pendingExpandAfterTabRef.current
    if (!pending) return
    if (activeTab !== pending) return
    expandIntakeAfterTabReady()
  }, [activeTab, expandIntakeAfterTabReady])

  // Keep return handler current without re-subscribing on every activeTab change.
  const returnToIntakeFromMapRef = useRef(returnToIntakeFromMap)
  returnToIntakeFromMapRef.current = returnToIntakeFromMap

  // Map overlay "← Return to Intake Form" — mount-once so tab switches don’t race View on Map.
  useEffect(() => {
    const onReturn = () => {
      consumePendingReturnToIntake()
      returnToIntakeFromMapRef.current()
    }
    window.addEventListener(LYNCR_RETURN_TO_INTAKE_EVENT, onReturn)
    if (consumePendingReturnToIntake()) {
      returnToIntakeFromMapRef.current()
    }
    return () => {
      window.removeEventListener(LYNCR_RETURN_TO_INTAKE_EVENT, onReturn)
      if (suppressSheetDismissTimerRef.current) {
        window.clearTimeout(suppressSheetDismissTimerRef.current)
        suppressSheetDismissTimerRef.current = null
      }
    }
  }, [])

  const viewOnMapLayout = useCallback(() => {
    const lat = form.serviceAddress?.lat
    const lng = form.serviceAddress?.lng
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast({
        title: "Pick a mapped address first",
        description: "Choose a suggestion so we can drop a destination pin on the Map tab.",
        variant: "destructive",
      })
      return
    }
    // Remember the tab we left so Return can restore it (usually Routing).
    intakeReturnTabRef.current = activeTab === "contacts" ? "dashboard" : activeTab
    // Cancel any in-flight return expand so Map navigation wins.
    pendingExpandAfterTabRef.current = null
    minimizeIntake()
    emitFocusDispatchMap({
      lat,
      lng,
      label: form.displayName.trim() || "Customer",
      address:
        form.serviceAddress?.formatted ||
        [form.addressLine1, form.city, form.postalCode].filter(Boolean).join(", ") ||
        undefined,
    })
    setActiveTab("contacts")
  }, [
    form.serviceAddress,
    form.displayName,
    form.addressLine1,
    form.city,
    form.postalCode,
    activeTab,
    minimizeIntake,
    setActiveTab,
    toast,
  ])

  if (!enabled && !manualCallRow) return null

  const callLinePhase = effectiveCurrent
    ? resolveIntakeCallLinePhase({
        manualCallStatus: effectiveCurrent.manualCallStatus,
        answered_at: effectiveCurrent.answered_at,
        ended_at: effectiveCurrent.ended_at,
        call_type: effectiveCurrent.call_type,
        status: effectiveCurrent.status,
        routed_to_name: effectiveCurrent.routed_to_name,
        duration_seconds: effectiveCurrent.duration_seconds,
      })
    : "ringing"
  const isRinging = callLinePhase === "ringing"
  const callHeaderLabel = intakeCallHeaderLabel(callLinePhase)
  const headerToneClass =
    callLinePhase === "answered"
      ? "text-primary"
      : callLinePhase === "missed"
        ? "text-rose-400"
        : callLinePhase === "voicemail"
          ? "text-violet-400"
          : callLinePhase === "ringing"
            ? "text-primary"
            : "text-muted-foreground"
  const requiresVehicle = serviceTypeRequiresVehicle(serviceTypeId)
  const intakePhoneDisplay = formatPhoneDisplay(
    form.phoneNumber || effectiveCurrent?.from_number || ""
  )
  const sheetOpen = effectiveCurrent != null && !isMinimized

  return (
    <>
      {secondaryIncoming && isCallActive ? (
        <SecondaryCallInterceptBanner
          leg={secondaryIncoming}
          organizationId={activeOrganizationId}
          onDismiss={() => setSecondaryIncoming(null)}
        />
      ) : null}

      {effectiveCurrent && isMinimized ? (
        <IntakePipTray
          phoneDisplay={intakePhoneDisplay || "Active call"}
          onExpand={expandIntake}
        />
      ) : null}

      <IntakeDraftRestoredFlash visible={draftRestoredFlash && sheetOpen} />

    <Sheet
      open={sheetOpen}
      onOpenChange={(o) => {
        // Minimizing flips `open` to false — do not dismiss or wipe form state.
        if (!o) {
          if (isMinimizedRef.current) return
          // Map "Return to Intake" / PiP expand — ignore spurious close from the same click.
          if (suppressSheetDismissRef.current) return
          dismissOnly()
        }
      }}
    >
      <SheetContent
        side="bottom"
        // Above CRM Dialog / Dialog overlay (z-[7000]/z-[7010]) so Convert-to-booking
        // intake is never trapped under a still-mounted customer profile modal.
        overlayClassName="z-[7200]"
        className="z-[7210] flex h-[85vh] max-h-[750px] flex-col gap-0 overflow-hidden p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3"
        onPointerDownOutside={(e) => {
          if (suppressSheetDismissRef.current) {
            e.preventDefault()
            return
          }
          const target = e.target as HTMLElement | null
          // Map "Return to Intake Form" — never treat that control as an outside dismiss.
          if (target?.closest("[data-return-to-intake]")) {
            e.preventDefault()
            return
          }
          // Leaflet tiles/controls sit under the overlay but can still synthesize outside events.
          if (target?.closest(".leaflet-container, .leaflet-pane, .leaflet-control")) {
            e.preventDefault()
            return
          }
          if (target?.closest("[data-address-suggestions]")) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (suppressSheetDismissRef.current) {
            e.preventDefault()
            return
          }
          const target = e.target as HTMLElement | null
          if (target?.closest("[data-return-to-intake]")) e.preventDefault()
          if (target?.closest(".leaflet-container, .leaflet-pane, .leaflet-control")) {
            e.preventDefault()
          }
        }}
      >
        {effectiveCurrent ? (
          effectiveCurrent.intakeMode === "quick" ? (
            <>
              {/* Missed-call quick note — skip YMM / multi-step booking chrome. */}
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 pb-3 pt-2 pr-12">
                <button
                  type="button"
                  onClick={minimizeIntake}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  aria-label="Minimize"
                  title="Minimize"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-300">
                    Missed call note
                  </p>
                  <p className="truncate text-sm font-medium text-foreground">
                    What was this about?
                  </p>
                </div>
              </div>
              <MissedCallQuickLogPanel
                phoneNumber={form.phoneNumber || effectiveCurrent.from_number}
                callLogId={effectiveCurrent.sourceCallLogId || effectiveCurrent.id}
                customerName={form.displayName || effectiveCurrent.caller_name}
                organizationId={activeOrganizationId}
                onSaved={() => {
                  clearDraftForCurrentCaller()
                  resetIntakeUiState()
                  dismissOnly()
                }}
                onBookJob={() => {
                  // Upgrade to the full answered booking wizard when they need to schedule.
                  patchManualCallRow({
                    intakeMode: "full",
                    manualCallStatus: "answered",
                  })
                  setCurrentStep("SERVICE_SELECT")
                }}
                onDismiss={dismissWithDraftClear}
              />
            </>
          ) : (
          <>
            {isManual ? (
              <ManualIntakeToolbar
                path={manualPath}
                currentStep={currentStep}
                phoneDisplay={formatPhoneDisplay(form.phoneNumber || effectiveCurrent.from_number)}
                lineState={effectiveCurrent.manualCallStatus ?? "answered"}
                onLineStateChange={setManualCallStatus}
                onMinimize={minimizeIntake}
              />
            ) : (
            <SheetHeader
              className={cn(
                "shrink-0 border-b border-border/60 pr-12 text-left",
                // Deep steps: tighter header so the year / address region gets the height.
                compactIntakeChrome ? "px-3 pb-1.5 pt-1.5" : "px-4 pb-3 pt-2"
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={minimizeIntake}
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                    compactIntakeChrome ? "mt-0 h-7 w-7" : "mt-0.5 h-8 w-8"
                  )}
                  aria-label="Minimize intake"
                  title="Minimize"
                >
                  <ChevronDown className={cn(compactIntakeChrome ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-semibold uppercase tracking-wide",
                  compactIntakeChrome ? "text-[9px] leading-tight" : "text-[10px]",
                  headerToneClass
                )}
              >
                {callHeaderLabel}
              </p>
              <SheetTitle
                className={cn(
                  "flex flex-wrap items-center gap-2 text-left",
                  compactIntakeChrome ? "text-base leading-tight" : "text-lg"
                )}
              >
                <Phone
                  className={cn(
                    "shrink-0 text-primary",
                    compactIntakeChrome ? "h-4 w-4" : "h-5 w-5",
                    isRinging && "animate-pulse"
                  )}
                  aria-hidden
                />
                <span className="tabular-nums">
                  {formatPhoneDisplay(form.phoneNumber || effectiveCurrent.from_number)}
                </span>
                {repeatUrgency.isHighUrgency ? (
                  <RepeatCallerUrgencyBadge attemptCount={repeatUrgency.attemptCount} />
                ) : null}
              </SheetTitle>
              {/* Profile owns garage/quote — hide header chips on returning-caller sheet. */}
              {!compactIntakeChrome &&
              !showReturningCallerCard &&
              (matchedCustomer || crmOpenLeadId) ? (
                <RepeatCustomerCrmChips
                  compact
                  garageVehicles={garageVehicles}
                  crmOpenLeadId={crmOpenLeadId}
                  crmOpenLeadQuoteCents={crmOpenLeadQuoteCents}
                  activeYear={form.vehicleYear}
                  activeMake={form.vehicleMake}
                  activeModel={form.vehicleModel}
                  onPickVehicle={applyGarageVehicle}
                />
              ) : null}
                </div>
              </div>
              <IncomingCallOpsToolbar
                className={compactIntakeChrome || showReturningCallerCard ? "mt-1" : "mt-2"}
                phoneE164={form.phoneNumber || effectiveCurrent.from_number}
                businessLineE164={effectiveCurrent.to_number}
                callLogId={effectiveCurrent.id}
                organizationId={activeOrganizationId}
                linePhase={callLinePhase}
                isRinging={isRinging}
                onDeclined={dismissOnly}
                urgency={repeatUrgency}
                onOpenActiveJob={openActiveJobOnScheduler}
                compactActions={compactIntakeChrome || showReturningCallerCard}
              />
              {!compactIntakeChrome && effectiveCurrent.recording_url ? (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-2">
                  <span className="font-mono text-xs text-zinc-400">Recording:</span>
                  <audio
                    src={effectiveCurrent.recording_url}
                    controls
                    className="h-8 w-full accent-cyan-400"
                  />
                </div>
              ) : null}
            </SheetHeader>
            )}
            {/* Standalone draft strip only on Service — never steal Vehicle year space. */}
            {pendingDraft &&
            sheetOpen &&
            !showReturningCallerCard &&
            currentStep === "SERVICE_SELECT" ? (
              <IntakeDraftRestoreBanner
                draft={pendingDraft}
                onRestore={restorePendingDraft}
                onDismiss={dismissPendingDraft}
              />
            ) : null}
            {/* Profile-first sheet — fills the body; Service wizard stays hidden until intent. */}
            {showReturningCallerCard ? (
              <ReturningCallerDecisionCard
                customerName={
                  matchedCustomer?.display_name?.trim() ||
                  form.displayName.trim() ||
                  (pendingDraft && !matchedCustomer && !crmOpenLeadId && !activeCallbackJobId
                    ? "Continue where you left off"
                    : "Returning caller")
                }
                phoneDisplay={formatPhoneDisplay(
                  matchedCustomer?.phone_e164 ||
                    form.phoneNumber ||
                    effectiveCurrent.from_number
                )}
                vehicleLabels={returningCallerVehicleLabels}
                addressLine={returningCallerAddressLine}
                lastJobLine={returningCallerLastJobLine}
                lastJobAddress={returningCallerLastJobAddress}
                openLeadId={crmOpenLeadId}
                openQuoteCents={crmOpenLeadQuoteCents}
                serviceTypeLabel={returningCallerServiceLabel}
                activeJobId={activeCallbackJobId}
                activeJobMeta={activeCallbackJobMeta}
                recentHistoryLines={returningCallerRecentHistory}
                lastPaidLine={returningCallerLastPaidLine}
                lifetimePaidLine={returningCallerLifetimeLine}
                recentCallLine={returningCallerRecentCallLine}
                pendingDraft={pendingDraft}
                restoreSecondary={restoreDraftSecondary}
                notesPreview={returningCallerNotes?.preview ?? null}
                notesHasMore={Boolean(returningCallerNotes?.hasMore)}
                emphasizeJob={Boolean(activeCallbackJobId)}
                hasCrmHistory={returningCallerHasCrmHistory}
                canOpenCrm={Boolean(matchedCustomer?.id)}
                bookFormSubmitted={fromBookFormOpen}
                primaryContinueLabel={returningCallerPrimary?.label ?? null}
                onPrimaryContinue={handleReturningCallerPrimaryContinue}
                onRestoreDraft={restorePendingDraft}
                onDismissDraft={dismissPendingDraft}
                onOpenCrm={handleOpenCrmForReturningCaller}
                onNewJob={handleNewJobForReturningCaller}
                onToggleNotes={() => setReturningCallerNotesExpanded((v) => !v)}
                notesExpanded={returningCallerNotesExpanded}
              />
            ) : null}
            {/* Compact sticky banner after Restore — hide on Vehicle so the year grid wins. */}
            {continuingDraft && !showReturningCallerCard && currentStep !== "VEHICLE_INFO" ? (
              <div
                className="sticky top-0 z-20 shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1"
                role="status"
              >
                <p className="truncate text-[11px] font-medium text-amber-50/95">
                  Continuing draft for{" "}
                  <span className="font-semibold text-amber-50">
                    {matchedCustomer?.display_name?.trim() ||
                      form.displayName.trim() ||
                      "this caller"}
                  </span>
                </p>
              </div>
            ) : null}
            {stepIntake && !isManual && !showReturningCallerCard ? (
              <IntakeStepProgress path={manualPath} currentStep={currentStep} />
            ) : null}

            {!showReturningCallerCard ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  stepIntake
                    ? cn(
                        "overflow-hidden",
                        // Deep steps: less padding so content (year grid) claims the viewport.
                        compactIntakeChrome ? "px-3 py-1.5" : "px-4 py-2"
                      )
                    : "space-y-4 overflow-y-auto overscroll-y-contain px-6 py-4"
                )}
              >
                {stepIntake ? (
                  <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={currentStep}
                        {...MANUAL_STEP_MOTION}
                        className={MANUAL_STEP_SHELL}
                      >
                        <div
                          ref={manualStepScrollRef}
                          className={cn(
                            // Vehicle: flex-fill shell — year grid owns scroll, not the whole page.
                            currentStep === "VEHICLE_INFO"
                              ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pb-28"
                              : cn(
                                  MANUAL_STEP_SCROLL,
                                  "relative z-10",
                                  // Extra bottom space so sticky footer does not cover model chips / key options.
                                  (currentStep === "KEY_SPECIFICS" ||
                                    currentStep === "JOB_TYPE") &&
                                    "pb-32"
                                )
                          )}
                        >
                          {currentStep === "SERVICE_SELECT" && !showReturningCallerCard ? (
                            <div className="space-y-3">
                              {callbackForceNewJob && matchedCustomer ? (
                                <p className="text-[11px] text-muted-foreground">
                                  New job for{" "}
                                  <span className="font-medium text-foreground">
                                    {matchedCustomer.display_name?.trim() || "this customer"}
                                  </span>{" "}
                                  — pick the service.
                                </p>
                              ) : null}
                              {/* Prefill / Suggest-from-call strip removed — not needed for live intake. */}
                              {continuingDraft ? (
                                <p className="text-[11px] text-muted-foreground">
                                  Pick the service for this draft — Lockout is not assumed.
                                </p>
                              ) : null}
                              <ServiceQuoteCalculatorPanel
                                quote={liveQuote}
                                serviceTypeId={selectorServiceTypeId}
                                vehicleYear={form.vehicleYear}
                                vehicleMake={form.vehicleMake}
                                vehicleModel={form.vehicleModel}
                                onServiceTypeChange={handleManualServiceTypeChange}
                                variant="selector-only"
                                compact
                                deferAutomotiveKeyTypes
                              />
                              <IntakeJobPhotosPanel
                                compact
                                callLogId={effectiveCurrent?.id ?? null}
                                customerPhone={
                                  resolvedPhoneNumber ||
                                  form.phoneNumber ||
                                  effectiveCurrent?.from_number ||
                                  ""
                                }
                                photos={jobPhotos}
                                onPhotosChange={setJobPhotos}
                                rescueMeta={rescueMeta}
                                onRescueMetaChange={setRescueMeta}
                              />
                            </div>
                          ) : null}

                          {currentStep === "VEHICLE_INFO" ? (
                            <fieldset
                              className={cn(
                                WS_SECTION,
                                // Fill the step — year/make/model grid is the dominant region.
                                "flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-2"
                              )}
                            >
                              <legend className="shrink-0 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                Vehicle year · make · model
                              </legend>
                              <p className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                                {vehicleLockoutIntake
                                  ? "Optional — helps the tech. Skip if they are in a hurry."
                                  : "Look the key up outside Lyncr while they hold."}
                              </p>
                              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                <VehiclePickerCascade
                                  variant="sequential"
                                  value={{
                                    vehicle_year: form.vehicleYear,
                                    vehicle_make: form.vehicleMake,
                                    vehicle_model: form.vehicleModel,
                                  }}
                                  onChange={handleManualVehicleChange}
                                />
                              </div>
                            </fieldset>
                          ) : null}

                          {currentStep === "JOB_TYPE" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                What do they need?
                              </legend>
                              <p className="text-sm text-muted-foreground">
                                Copy (have a key) or all keys lost (AKL)? Then we&apos;ll get year / make /
                                model.
                              </p>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {PRIMARY_JOB_TYPE_OPTIONS.map((service, index) => {
                                  const active = serviceTypeId === service.id
                                  return (
                                    <button
                                      key={service.id}
                                      type="button"
                                      data-intake-primary-option={index === 0 ? "" : undefined}
                                      onClick={() => handleJobTypeChange(service.id)}
                                      className={cn(
                                        "rounded-lg border px-3 py-3.5 text-left text-sm font-semibold transition-colors",
                                        active
                                          ? "border-primary/50 bg-primary/15 text-primary"
                                          : "border-border bg-card/40 text-foreground hover:bg-muted/50"
                                      )}
                                      aria-pressed={active}
                                    >
                                      {service.id === "key_generation"
                                        ? "All keys lost (AKL)"
                                        : "Need a copy / spare"}
                                      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                                        {service.label}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowMoreJobTypes((open) => !open)}
                                className="text-left text-xs font-semibold text-primary underline-offset-2 hover:underline"
                              >
                                {showMoreJobTypes
                                  ? "Hide other job types"
                                  : "More — programming, ignition, extraction…"}
                              </button>
                              {showMoreJobTypes ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {SECONDARY_JOB_TYPE_OPTIONS.map((service) => {
                                    const active = serviceTypeId === service.id
                                    return (
                                      <button
                                        key={service.id}
                                        type="button"
                                        onClick={() => handleJobTypeChange(service.id)}
                                        className={cn(
                                          "rounded-lg border px-3 py-3 text-left text-sm font-semibold transition-colors",
                                          active
                                            ? "border-primary/50 bg-primary/15 text-primary"
                                            : "border-border bg-card/40 text-foreground hover:bg-muted/50"
                                        )}
                                        aria-pressed={active}
                                      >
                                        {service.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </fieldset>
                          ) : null}

                          {currentStep === "KEY_SPECIFICS" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                Lookup notes (optional)
                              </legend>
                              <p className="text-sm text-muted-foreground">
                                Key catalog search in Lyncr is optional. Look the key up on your usual
                                3rd-party sites, then type anything useful here.
                              </p>
                              {(form.vehicleYear || form.vehicleMake || form.vehicleModel) ? (
                                <div className="text-xs font-medium uppercase tracking-wide text-emerald-400">
                                  {[form.vehicleYear, form.vehicleMake, form.vehicleModel]
                                    .filter(Boolean)
                                    .join(" ")}
                                </div>
                              ) : null}
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label htmlFor="lookup-key-style" className="text-xs">
                                    Key type / style
                                  </Label>
                                  <Input
                                    id="lookup-key-style"
                                    value={form.keyStyle}
                                    onChange={(e) => patchForm({ keyStyle: e.target.value })}
                                    placeholder="e.g. proximity fob, blade…"
                                    className="h-10"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="lookup-fcc" className="text-xs">
                                    FCC / part # (if you wrote it down)
                                  </Label>
                                  <Input
                                    id="lookup-fcc"
                                    value={form.keyFccId}
                                    onChange={(e) => patchForm({ keyFccId: e.target.value })}
                                    placeholder="Optional"
                                    className="h-10 font-mono"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="lookup-notes" className="text-xs">
                                  Notes from your lookup
                                </Label>
                                <textarea
                                  id="lookup-notes"
                                  value={form.notes}
                                  onChange={(e) => patchForm({ notes: e.target.value })}
                                  rows={3}
                                  placeholder="AKL / blade / programming notes…"
                                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => patchForm({ serviceVenue: "mobile" })}
                                  className={cn(
                                    "rounded-xl border px-2 py-2.5 text-left text-xs font-semibold transition-colors",
                                    form.serviceVenue === "mobile"
                                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                                      : "border-zinc-700 bg-zinc-900 text-slate-300"
                                  )}
                                >
                                  I go to them
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    patchForm({ serviceVenue: "shop" })
                                    if (!customPrice.trim()) {
                                      setCustomPrice("75")
                                      setQuotedPriceDollars(75)
                                    }
                                  }}
                                  className={cn(
                                    "rounded-xl border px-2 py-2.5 text-left text-xs font-semibold transition-colors",
                                    form.serviceVenue === "shop"
                                      ? "border-amber-500/50 bg-amber-500/15 text-amber-50"
                                      : "border-zinc-700 bg-zinc-900 text-slate-300"
                                  )}
                                >
                                  They come to shop
                                </button>
                              </div>
                              <Button
                                type="button"
                                size="lg"
                                className="h-11 w-full font-semibold"
                                onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                              >
                                Continue to location →
                              </Button>
                            </fieldset>
                          ) : null}

                          {currentStep === "ADDRESS_CONTACT" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                Location
                              </legend>
                              {requiresVehicle && serviceTypeId === "key_generation" ? (
                                <p className="text-[11px] text-amber-200/90">
                                  AKL: get the address before you quote.
                                </p>
                              ) : null}
                              {requiresVehicle ? (
                                <details className="text-[11px] text-muted-foreground">
                                  <summary className="cursor-pointer font-medium">
                                    Key lookup notes (optional)
                                  </summary>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    <Input
                                      value={form.keyStyle}
                                      onChange={(e) => patchForm({ keyStyle: e.target.value })}
                                      placeholder="Key type / style"
                                      className="h-9"
                                    />
                                    <Input
                                      value={form.keyFccId}
                                      onChange={(e) => patchForm({ keyFccId: e.target.value })}
                                      placeholder="FCC / part # (optional)"
                                      className="h-9 font-mono"
                                    />
                                  </div>
                                </details>
                              ) : null}
                              <div className="space-y-1.5">
                                <Label htmlFor="manual-ac-phone" className="text-xs">
                                  Phone number
                                </Label>
                                <div className="flex gap-2">
                                  <Input
                                    id="manual-ac-phone"
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel"
                                    value={resolvedPhoneNumber}
                                    onChange={(e) => patchForm({ phoneNumber: e.target.value })}
                                    placeholder="(502) 555-1234"
                                    className="h-10 flex-1 font-mono text-base"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void requestLiveGps()}
                                    disabled={gpsRequestState === "sending"}
                                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-[11px] font-bold text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
                                    title="Text customer a live GPS share link"
                                  >
                                    {gpsRequestState === "sending" ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                    ) : (
                                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                                    )}
                                    Live GPS
                                  </button>
                                </div>
                                {gpsRequestState === "sent" ? (
                                  <p className="text-[10px] text-emerald-400">
                                    Locate link texted — waiting for customer GPS…
                                  </p>
                                ) : null}
                              </div>
                              <div className="space-y-1.5 overflow-visible">
                                <Label className="text-xs">
                                  Service address <span className="text-primary">*</span>
                                </Label>
                                <JobAddressAutocomplete
                                  ref={addressSearchRef}
                                  value={form.serviceAddress}
                                  onChange={handleManualAddressChange}
                                  onQueryCommit={handleAddressQueryCommit}
                                  seedQuery={addressSeedQuery}
                                  placeholder="Start typing street address…"
                                />
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <button
                                    type="button"
                                    onClick={viewOnMapLayout}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-300/90 underline-offset-2 hover:underline"
                                  >
                                    <MapPin className="h-3 w-3" aria-hidden />
                                    View on map
                                  </button>
                                  <NearestTechDispatchBadge
                                    jobLat={form.serviceAddress?.lat ?? null}
                                    jobLng={form.serviceAddress?.lng ?? null}
                                  />
                                </div>
                                <IntakeJobPhotosPanel
                                  compact
                                  callLogId={effectiveCurrent?.id ?? null}
                                  customerPhone={
                                    resolvedPhoneNumber ||
                                    form.phoneNumber ||
                                    effectiveCurrent?.from_number ||
                                    ""
                                  }
                                  photos={jobPhotos}
                                  onPhotosChange={setJobPhotos}
                                  rescueMeta={rescueMeta}
                                  onRescueMetaChange={setRescueMeta}
                                />
                              </div>
                            </fieldset>
                          ) : null}

                          {currentStep === "SCHEDULE_TIME" ? (
                            <div className={cn(WS_SECTION, "grid gap-3")}>
                              <IntakeSchedulePreferenceFields
                                value={{
                                  scheduleUrgency: form.scheduleUrgency,
                                  scheduledDate: form.scheduledDate,
                                  scheduledTime: form.scheduledTime,
                                  availabilityFrom: form.availabilityFrom,
                                  availabilityTo: form.availabilityTo,
                                }}
                                onChange={(patch) => patchForm(patch)}
                                subtitle={
                                  [form.addressLine1, form.city, form.postalCode]
                                    .filter(Boolean)
                                    .join(", ") ||
                                  form.serviceAddress?.formatted ||
                                  "Service address selected"
                                }
                              />
                              {/* Hidden focus target for keyboard / a11y jump into Schedule. */}
                              <button
                                id="intake-schedule-asap"
                                type="button"
                                className="sr-only"
                                onClick={() =>
                                  patchForm({ scheduleUrgency: "asap", scheduledTime: "" })
                                }
                              >
                                Focus ASAP
                              </button>
                            </div>
                          ) : null}

                          {currentStep === "CUSTOMER_NAME" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-sm font-semibold tracking-tight text-foreground">
                                Customer &amp; quote
                              </legend>
                              <div className="grid gap-3 rounded-xl border border-border/70 bg-card/40 p-3">
                                <div className="space-y-1.5">
                                  <Label htmlFor="manual-ac-display" className="text-xs">
                                    Caller name <span className="text-primary">*</span>
                                  </Label>
                                  <Input
                                    id="manual-ac-display"
                                    value={form.displayName}
                                    onChange={(e) => patchForm({ displayName: e.target.value })}
                                    placeholder="Customer full name"
                                    className="h-12 text-base"
                                    autoFocus
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="manual-ac-quote" className="text-xs">
                                    Pitched quote ($)
                                  </Label>
                                  <Input
                                    id="manual-ac-quote"
                                    inputMode="decimal"
                                    value={customPrice}
                                    onChange={(e) => setCustomPrice(e.target.value)}
                                    placeholder={
                                      liveQuote.totalCents > 0
                                        ? String(Math.round(liveQuote.totalCents / 100))
                                        : "0"
                                    }
                                    className="h-11 font-mono text-base tabular-nums"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {[form.addressLine1, form.city, form.postalCode].filter(Boolean).join(", ") ||
                                    form.serviceAddress?.formatted ||
                                    "—"}
                                  {scheduleSummaryLabel ? (
                                    <>
                                      {" · "}
                                      <span className="tabular-nums">{scheduleSummaryLabel}</span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground/80"> · Schedule next</span>
                                  )}
                                </p>
                              </div>
                            </fieldset>
                          ) : null}

                          {currentStep === "BOOKING_COMPLETE" ? (
                            <div className="flex flex-col items-stretch gap-4 py-2">
                              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-center">
                                <p className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-200">
                                  Booking secured
                                </p>
                                <p className="mt-3 text-lg font-semibold text-foreground">
                                  {form.displayName.trim() || "Customer"} is on the calendar
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {[form.addressLine1, form.city].filter(Boolean).join(", ") ||
                                    form.serviceAddress?.formatted}
                                </p>
                                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                                  {scheduleSummaryLabel || "Schedule preference saved"}
                                </p>
                              </div>
                              {confirmSmsDraft && !confirmSmsResolved ? (
                                <AppointmentConfirmSmsPanel
                                  toPhone={
                                    resolvedPhoneNumber ||
                                    form.phoneNumber ||
                                    effectiveCurrent?.from_number ||
                                    ""
                                  }
                                  fromLine={effectiveCurrent?.to_number ?? null}
                                  organizationId={activeOrganizationId}
                                  leadId={bookedLeadId}
                                  draftText={confirmSmsDraft}
                                  customerFirstName={
                                    form.displayName.trim().split(/\s+/)[0] || "there"
                                  }
                                  appointmentLabel={scheduleSummaryLabel}
                                  onSent={() => setConfirmSmsResolved(true)}
                                  onSkip={() => {
                                    setConfirmSmsResolved(true)
                                    toast({
                                      title: "SMS skipped",
                                      description: "No confirmation text was sent.",
                                    })
                                  }}
                                />
                              ) : confirmSmsResolved ? (
                                <p className="text-center text-[11px] font-medium text-emerald-200/90">
                                  {confirmSmsDraft
                                    ? "Confirmation SMS handled — you can open the scheduler or close."
                                    : "Booking saved."}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                ) : (
                  <>
                <ServiceQuoteCalculatorPanel
                  quote={liveQuote}
                  serviceTypeId={serviceTypeId}
                  vehicleYear={form.vehicleYear}
                  vehicleMake={form.vehicleMake}
                  vehicleModel={form.vehicleModel}
                  postalCode={form.postalCode || form.serviceAddress?.postal_code}
                  onServiceTypeChange={setServiceQuoteTypeId}
                  onEstimateChange={handleQuoteEstimateChange}
                  onFlatPriceChange={handleFlatPriceChange}
                />

                <IntakeJobPhotosPanel
                  callLogId={effectiveCurrent?.id ?? null}
                  customerPhone={
                    resolvedPhoneNumber || form.phoneNumber || effectiveCurrent?.from_number || ""
                  }
                  photos={jobPhotos}
                  onPhotosChange={setJobPhotos}
                  rescueMeta={rescueMeta}
                  onRescueMetaChange={setRescueMeta}
                />

                {requiresVehicle ? (
                  <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                      Vehicle metadata
                    </legend>
                    <p className="text-[11px] text-muted-foreground">
                      Look the key up outside Lyncr while they hold.
                    </p>
                    <VehiclePickerCascade
                      value={{
                        vehicle_year: form.vehicleYear,
                        vehicle_make: form.vehicleMake,
                        vehicle_model: form.vehicleModel,
                      }}
                      onChange={setVehicle}
                    />
                    {(form.vehicleYear || form.vehicleMake || form.vehicleModel) ? (
                      <div className="text-xs font-medium uppercase tracking-wide text-emerald-400">
                        Selected Vehicle: {[form.vehicleYear, form.vehicleMake, form.vehicleModel]
                          .filter(Boolean)
                          .join(" ")}
                      </div>
                    ) : null}
                    <VehicleIntakeClarificationsPanel
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      answeredIds={answeredClarificationSet}
                      onAnswer={applyVehicleClarification}
                      onFccAutoResolved={applyFccAutoResolved}
                      onPendingKeyClarificationChange={setKeyClarificationPending}
                    />
                    <VehicleKeyInfoPanel
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      vehicleTrim={form.vehicleTrim}
                      factoryOptions={form.factoryOptions}
                      onVehicleTrimChange={(trim) => patchForm({ vehicleTrim: trim })}
                      fccId={form.keyFccId || null}
                      holdForClarification={keyClarificationPending}
                      value={
                        form.keyFccId || form.keyStyle
                          ? {
                              profileId: form.keyProfileId,
                              fccId: form.keyFccId,
                              frequency: form.keyFrequency || null,
                              chipset: form.keyChipset || null,
                              keyStyle: form.keyStyle || "Not sure yet",
                              variantId: form.keyVariantId || null,
                              programmingMethod: form.programmingMethod || null,
                              tiSku: form.tiSku || null,
                            }
                          : null
                      }
                      onChange={setVehicleKeySelection}
                      onVehicleFromVin={handleVehicleFromVin}
                      preloadedKeyBundle={preloadedKeyBundle}
                      onInventoryLoaded={handleInventoryLoaded}
                    />
                    <CallTimeInventoryIntake
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      selectedFccId={form.keyFccId || null}
                      selectedFrequency={form.keyFrequency || null}
                      selectedTiSku={form.tiSku || null}
                      organizationId={activeOrganizationId}
                      inventory={preloadedKeyBundle?.inventory}
                      onInventoryUpdated={mergeInventoryItem}
                      onMarkedOutOfStock={() => {
                        requestAnimationFrame(() => {
                          document
                            .getElementById("key-details-alternative-solutions-flat")
                            ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                        })
                      }}
                    />
                    <div id="key-details-alternative-solutions-flat">
                      <OutOfStockFallbackCard
                        inventory={preloadedKeyBundle?.inventory}
                        vehicleResolved={vehicleResolvedForStock}
                        intake={stockFallbackIntake}
                        onSpecialOrderDone={({ earliestServiceDate }) => {
                          toast({
                            title: "Special order link ready",
                            description: `Status: Pending Deposit · earliest service ${earliestServiceDate}. Copy or open the Stripe link for the customer.`,
                          })
                        }}
                        onPartnerLeadDone={({ referralStatus, affiliateName }) => {
                          toast({
                            title: `Lead sent to ${affiliateName}`,
                            description: referralStatus,
                          })
                          closeIntakeAfterSave()
                          // Partner referrals land in CRM Leads for follow-up.
                          router.push("/dashboard/customers?tab=leads")
                        }}
                      />
                    </div>
                  </fieldset>
                ) : null}

                <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary/90">
                    Job details
                  </legend>
                  <div className="space-y-1.5 overflow-visible">
                    <Label className="text-xs">
                      Service address <span className="text-primary">*</span>
                    </Label>
                    <JobAddressAutocomplete
                      ref={addressSearchRef}
                      value={form.serviceAddress}
                      onChange={handleManualAddressChange}
                      onQueryCommit={handleAddressQueryCommit}
                      seedQuery={addressSeedQuery}
                      placeholder="Start typing street address…"
                    />
                    <button
                      type="button"
                      onClick={viewOnMapLayout}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[11px] font-semibold text-sky-200 transition-colors hover:bg-sky-500/20"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      View on Map Layout
                    </button>
                    <NearestTechDispatchBadge
                      jobLat={form.serviceAddress?.lat ?? null}
                      jobLng={form.serviceAddress?.lng ?? null}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {addressReady
                        ? "Address ready — tap Send to dispatch map."
                        : "Type street + city, tap a suggestion, or tap out of the field when done."}
                    </p>
                    <IntakeTravelPreview
                      dispatcherLat={dispatcherLocation.lat}
                      dispatcherLng={dispatcherLocation.lng}
                      jobLat={form.serviceAddress?.lat ?? null}
                      jobLng={form.serviceAddress?.lng ?? null}
                      distanceMiles={travelDistanceMiles}
                      locationStatus={dispatcherLocation.status}
                      locationError={dispatcherLocation.error}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-notes" className="text-xs">
                      Job notes
                    </Label>
                    <Input
                      id="ac-notes"
                      value={form.notes}
                      onChange={(e) => patchForm({ notes: e.target.value })}
                      placeholder="Gate code, spare location, details…"
                      className="h-10"
                    />
                  </div>
                  <div className="grid gap-3">
                    <IntakeSchedulePreferenceFields
                      value={{
                        scheduleUrgency: form.scheduleUrgency,
                        scheduledDate: form.scheduledDate,
                        scheduledTime: form.scheduledTime,
                        availabilityFrom: form.availabilityFrom,
                        availabilityTo: form.availabilityTo,
                      }}
                      onChange={(patch) => patchForm(patch)}
                    />
                  </div>
                </fieldset>

                <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    Contact (saved to customer list)
                  </legend>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-display" className="text-xs">
                      Caller name <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="ac-display"
                      value={form.displayName}
                      onChange={(e) => patchForm({ displayName: e.target.value })}
                      placeholder="Ask before they hang up"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-phone" className="text-xs">
                      Phone number
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="ac-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={resolvedPhoneNumber}
                        onChange={(e) => patchForm({ phoneNumber: e.target.value })}
                        placeholder="(502) 555-1234"
                        className="h-10 flex-1 font-mono text-base"
                      />
                      <button
                        type="button"
                        onClick={() => void requestLiveGps()}
                        disabled={gpsRequestState === "sending"}
                        className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-[11px] font-bold text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        {gpsRequestState === "sending" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Request Live GPS
                      </button>
                    </div>
                  </div>
                  {matchedCustomer ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                      <p className="text-[11px] font-semibold text-amber-200">Returning caller</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">
                        {matchedCustomer.display_name?.trim() || "Returning caller"}
                      </p>
                      {(() => {
                        const noteSummary = summarizeReturningCallerNotes(matchedCustomer.notes)
                        return noteSummary ? (
                          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                            Notes · {noteSummary.preview}
                          </p>
                        ) : null
                      })()}
                      <RepeatCustomerCrmChips
                        garageVehicles={garageVehicles}
                        crmOpenLeadId={crmOpenLeadId}
                        crmOpenLeadQuoteCents={crmOpenLeadQuoteCents}
                        activeYear={form.vehicleYear}
                        activeMake={form.vehicleMake}
                        activeModel={form.vehicleModel}
                        onPickVehicle={applyGarageVehicle}
                      />
                    </div>
                  ) : null}
                </fieldset>
                  </>
                )}
              </div>

              <div className="sticky bottom-0 shrink-0 space-y-1.5 border-t border-slate-800 bg-slate-900 p-2">
                {stepIntake ? (
                  <>
                    {currentStep === "JOB_TYPE" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="h-11 w-full"
                        onClick={() => goBackManualWorkflow(manualPath)}
                      >
                        Back to service
                      </Button>
                    ) : null}
                    {currentStep === "KEY_SPECIFICS" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-11 shrink-0"
                          onClick={() => goBackManualWorkflow(manualPath)}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          size="lg"
                          className="h-11 min-w-0 flex-1"
                          onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                        >
                          Continue to location
                        </Button>
                      </div>
                    ) : null}
                    {currentStep === "ADDRESS_CONTACT" ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="h-11 shrink-0"
                            onClick={() => goBackManualWorkflow(manualPath)}
                          >
                            Back
                          </Button>
                          <Button
                            type="button"
                            size="lg"
                            className={cn(
                              "h-11 min-w-0 flex-1 font-semibold",
                              !canAdvanceFromLocation && "opacity-50"
                            )}
                            disabled={!canAdvanceFromLocation}
                            onClick={() => setCurrentStep("CUSTOMER_NAME")}
                          >
                            {canAdvanceFromLocation
                              ? "Continue to Customer Details →"
                              : "Enter a Service Address to Continue"}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          className="h-11 w-full border border-amber-500/40 bg-amber-500/10 text-amber-50 hover:bg-amber-500/20"
                          disabled={jobState === "creating" || !canSaveQuoteLead}
                          onClick={() => void saveQuoteLead()}
                        >
                          {jobState === "creating" ? "Saving…" : "Save Quote & Hang Up"}
                        </Button>
                      </div>
                    ) : null}
                    {currentStep === "CUSTOMER_NAME" ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-full"
                          onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                        >
                          Back to location
                        </Button>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                            <span className="font-bold text-emerald-400">$</span>
                            <input
                              id="manual-ac-quote-price"
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={1}
                              value={customPrice}
                              onChange={(e) => {
                                setCustomPrice(e.target.value)
                                const raw = e.target.value.trim()
                                if (!raw) return
                                const dollars = Number.parseFloat(raw)
                                if (Number.isFinite(dollars) && dollars >= 0) {
                                  setQuotedPriceDollars(dollars)
                                }
                              }}
                              onBlur={() => {
                                if (!customPrice.trim()) {
                                  syncQuotedPriceToAuto()
                                  setCustomPrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
                                }
                              }}
                              className="w-16 border-none bg-transparent p-0 text-xl font-bold text-emerald-400 focus:outline-none focus:ring-0"
                              aria-label="Quote before dispatch"
                            />
                          </div>
                          <Button
                            type="button"
                            size="lg"
                            className={cn(
                              "min-w-0 flex-1 gap-2 font-semibold",
                              (!canFinalizeBooking || !canDispatch) && "opacity-50",
                              highlightConfirmBook &&
                                "animate-pulse border-emerald-400 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-slate-900 shadow-[0_0_20px_rgba(52,211,153,0.35)]"
                            )}
                            disabled={
                              jobState === "creating" || !canFinalizeBooking || !canDispatch
                            }
                            onClick={() => {
                              // Flush quote into the ticket, then pick date/time.
                              applyCustomPriceToForm()
                              setCurrentStep("SCHEDULE_TIME")
                            }}
                          >
                            Booked — secure appointment →
                          </Button>
                        </div>

                        {/* Live-call outcomes after the quote — big taps, few choices */}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            className="h-11 border border-amber-500/40 bg-amber-500/10 font-semibold text-amber-50 hover:bg-amber-500/20"
                            disabled={lostLeadState === "saving"}
                            onClick={() => void markPriceShopping()}
                          >
                            {lostLeadState === "saving" ? "Saving…" : "Price shopping"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            className="h-11 border border-sky-500/40 bg-sky-500/10 font-semibold text-sky-50 hover:bg-sky-500/20"
                            disabled={serviceCallLinkBusy}
                            onClick={() => void sendServiceCallFeeLink()}
                          >
                            {serviceCallLinkBusy ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                            ) : null}
                            Send $49 service call
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="h-11 font-semibold"
                            onClick={openIntakeBookingLink}
                          >
                            Text booking link
                          </Button>
                        </div>
                        {lostLeadError ? (
                          <p className="text-center text-[11px] text-red-300">{lostLeadError}</p>
                        ) : null}

                        <button
                          type="button"
                          disabled={jobState === "creating" || !canSavePendingLead}
                          onClick={() => void savePendingLead()}
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {jobState === "creating" ? "Saving…" : "Save as Pending Lead / Callback"}
                        </button>
                        {!canDispatch && jobState !== "creating" && dispatchBlockers.length > 0 ? (
                          <p className="text-center text-[10px] text-amber-200/90">
                            Still needed: {dispatchBlockers.join(" · ")}
                          </p>
                        ) : null}
                        {jobError ? <p className="text-[11px] text-red-300">{jobError}</p> : null}
                      </>
                    ) : null}
                    {currentStep === "SCHEDULE_TIME" ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="h-11 shrink-0"
                            onClick={() => setCurrentStep("CUSTOMER_NAME")}
                          >
                            Back
                          </Button>
                          <Button
                            type="button"
                            size="lg"
                            className={cn(
                              "h-11 min-w-0 flex-1 gap-2 font-semibold",
                              (!canConfirmSchedule || !canDispatch) && "opacity-50",
                              highlightConfirmBook &&
                                "animate-pulse border-emerald-400 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-slate-900 shadow-[0_0_20px_rgba(52,211,153,0.35)]"
                            )}
                            disabled={
                              jobState === "creating" || !canConfirmSchedule || !canDispatch
                            }
                            onClick={() => void confirmAndBook()}
                          >
                            {jobState === "creating" ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : null}
                            {canConfirmSchedule
                              ? form.scheduleUrgency === "asap"
                                ? "Confirm ASAP →"
                                : "Confirm window →"
                              : "Pick ASAP or a window"}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          className="h-11 w-full border border-amber-500/40 bg-amber-500/10 text-amber-50 hover:bg-amber-500/20"
                          disabled={jobState === "creating" || !canSaveQuoteLead}
                          onClick={() => void saveQuoteLead()}
                        >
                          {jobState === "creating" ? "Saving…" : "Save Quote & Hang Up"}
                        </Button>
                      </div>
                    ) : null}
                    {currentStep === "BOOKING_COMPLETE" ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          size="lg"
                          className="h-11 w-full font-semibold"
                          disabled={Boolean(confirmSmsDraft && !confirmSmsResolved)}
                          onClick={finishBookingAndOpenScheduler}
                        >
                          Open on Scheduler
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-11 w-full"
                          disabled={Boolean(confirmSmsDraft && !confirmSmsResolved)}
                          onClick={dismissBookingComplete}
                        >
                          Done
                        </Button>
                        {confirmSmsDraft && !confirmSmsResolved ? (
                          <p className="text-center text-[10px] text-amber-200/90">
                            Send or skip the confirmation SMS to continue
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {(currentStep === "VEHICLE_INFO" ||
                      currentStep === "JOB_TYPE" ||
                      currentStep === "SERVICE_SELECT") &&
                    previousWorkflowStep(manualPath, currentStep) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full"
                        onClick={() => goBackManualWorkflow(manualPath)}
                      >
                        Back
                      </Button>
                    ) : null}
                    {currentStep === "VEHICLE_INFO" && vehicleLockoutIntake ? (
                      <Button
                        type="button"
                        size="lg"
                        variant={vehicleYmmComplete ? "default" : "outline"}
                        className="h-11 w-full"
                        onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                      >
                        {vehicleYmmComplete
                          ? "Next: Location"
                          : "Skip vehicle — go to location"}
                      </Button>
                    ) : null}
                    {currentStep === "VEHICLE_INFO" &&
                    !vehicleLockoutIntake &&
                    vehicleYmmComplete ? (
                      <Button
                        type="button"
                        size="lg"
                        className="h-11 w-full"
                        onClick={() =>
                          setCurrentStep(nextStepAfterVehicleInfo(serviceTypeId, vehicleLockoutIntake))
                        }
                      >
                        {serviceTypeId === "key_generation"
                          ? "Next: Address (before quote)"
                          : "Next: Location"}
                      </Button>
                    ) : null}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <IntakeAutoSaveStatus saveState={saveState} draftPulse={draftPulse} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={jobState === "creating"}
                        onClick={dismissWithDraftClear}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                <div className="flex items-center gap-2">
                  <div className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                    <span className="font-bold text-emerald-400">$</span>
                    <input
                      id="ac-quote-price"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={1}
                      value={customPrice}
                      onChange={(e) => {
                        setCustomPrice(e.target.value)
                        const raw = e.target.value.trim()
                        if (!raw) return
                        const dollars = Number.parseFloat(raw)
                        if (Number.isFinite(dollars) && dollars >= 0) {
                          setQuotedPriceDollars(dollars)
                        }
                      }}
                      onBlur={() => {
                        if (!customPrice.trim()) {
                          syncQuotedPriceToAuto()
                          setCustomPrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
                        }
                      }}
                      className="w-16 border-none bg-transparent p-0 text-xl font-bold text-emerald-400 focus:outline-none focus:ring-0"
                      aria-label="Quote before dispatch"
                    />
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    className={cn(
                      "min-w-0 flex-1 gap-2",
                      highlightConfirmBook &&
                        "animate-pulse border-emerald-400 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-slate-900 shadow-[0_0_20px_rgba(52,211,153,0.35)]"
                    )}
                    disabled={jobState === "creating" || !canDispatch}
                    onClick={() => void confirmAndBook()}
                  >
                    {jobState === "creating" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    Confirm &amp; book
                  </Button>
                </div>
                <button
                  type="button"
                  disabled={jobState === "creating" || !canSavePendingLead}
                  onClick={() => void savePendingLead()}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {jobState === "creating" ? "Saving…" : "Save as Pending Lead / Callback"}
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  size="default"
                  className="h-10 w-full gap-2"
                  disabled={jobState === "creating" || !canDispatch}
                  onClick={() => void sendToDispatch()}
                >
                  Send to dispatch map &amp; schedule
                </Button>
                {!canDispatch && jobState !== "creating" && dispatchBlockers.length > 0 ? (
                  <p className="text-center text-[10px] text-amber-200/90">
                    Still needed: {dispatchBlockers.join(" · ")}
                  </p>
                ) : null}
                {jobState === "created" ? (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100">
                    Job added to the hopper — assign when ready.
                  </p>
                ) : null}
                {jobError ? <p className="text-[11px] text-red-300">{jobError}</p> : null}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="inline-flex items-center gap-2">
                    <IntakeAutoSaveStatus saveState={saveState} draftPulse={draftPulse} />
                    <Link
                      href="/dashboard/customers"
                      className="text-[10px] font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Customers
                    </Link>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={jobState === "creating"}
                    onClick={dismissWithDraftClear}
                  >
                    Dismiss
                  </Button>
                </div>
                  </>
                )}
              </div>
            </div>
            ) : null}
          </>
          )
        ) : null}
      </SheetContent>
    </Sheet>
    <SendBookLinkSheet
      open={bookingLinkOpen}
      onOpenChange={setBookingLinkOpen}
      phone={
        resolvedPhoneNumber || form.phoneNumber || effectiveCurrent?.from_number || ""
      }
      callerName={form.displayName || undefined}
      businessLine={effectiveCurrent?.to_number || null}
      callLogId={
        effectiveCurrent?.sourceCallLogId?.trim() ||
        (effectiveCurrent && !effectiveCurrent.isManual ? effectiveCurrent.id : null)
      }
      suggestedQuoteDollars={autoTotalDollars > 0 ? autoTotalDollars : null}
    />
    </>
  )
}
