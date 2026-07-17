"use client"

// Answered-call intake sheet — opens on `call-initiated` (ringing) via Pusher, then upgrades on `call-answered`.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { Loader2, ChevronDown, MapPin, Phone, PhoneOff } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { VehicleFastLookupField } from "@/components/vehicle-fast-lookup-field"
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
import { IntakePipTray } from "@/components/dashboard/intake-pip-tray"
import {
  SecondaryCallInterceptBanner,
  type SecondaryIncomingLeg,
} from "@/components/dashboard/secondary-call-intercept-banner"
import { PriceNegotiationHelperPanel } from "@/components/price-negotiation-helper-panel"
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
import { useIsMobile } from "@/hooks/use-mobile"
import { manualIntakeStepAfterService } from "@/lib/service-sector-routing"
import { serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import type { ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import {
  negotiationDiscountLabel,
  parseQuoteDollars,
  recoveryStepPrices,
  routeMatchRecoveryScript,
  aftermarketRecoveryScript,
  managementFloorRecoveryScript,
} from "@/lib/price-negotiation"
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
  talkSecondsFromCompletedPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  consumePendingReturnToIntake,
  emitFocusDispatchMap,
  LYNCR_RETURN_TO_INTAKE_EVENT,
} from "@/lib/dispatch-map-focus"
import type { PageId } from "@/components/app-shell"
import { useToast } from "@/hooks/use-toast"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { useRepeatCallerUrgency } from "@/lib/hooks/use-repeat-caller-urgency"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import { revalidateLeadsWorkspaceCache } from "@/lib/leads-cache"
import { revalidateSchedulerJobPoolCaches } from "@/lib/hooks/use-job-pool-query"
import {
  loadAnsweredIntakeDismissed,
  markAnsweredIntakeDismissed,
  subscribeAnsweredIntakeDismissed,
} from "@/lib/answered-call-intake-dismiss"
import { isFlatAddressReadyForDispatch } from "@/lib/intake-address-helpers"
import {
  clearIntakeDraft,
  getDraftByPhoneNumber,
  isValidIntakeDraftPhone,
  normalizeIntakeDraftPhone,
  saveIntakeDraft,
} from "@/lib/intake-draft-storage"
import type { StructuredAddress } from "@/lib/structured-address"
import { cn } from "@/lib/utils"

/** Manual intake micro-step views — branching by service type. */
type WorkflowStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "KEY_SPECIFICS"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"
  | "CUSTOMER_NAME"
  | "BOOKING_COMPLETE"

const WORKFLOW_STEP_LABELS: Record<WorkflowStep, string> = {
  SERVICE_SELECT: "Service",
  VEHICLE_INFO: "Vehicle",
  KEY_SPECIFICS: "Key details",
  ADDRESS_CONTACT: "Location",
  SCHEDULE_TIME: "Schedule",
  CUSTOMER_NAME: "Customer",
  BOOKING_COMPLETE: "Done",
}

function manualWorkflowPath(serviceTypeId: ServiceQuoteTypeId): WorkflowStep[] {
  const path: WorkflowStep[] = ["SERVICE_SELECT"]
  if (serviceTypeRequiresVehicle(serviceTypeId)) {
    path.push("VEHICLE_INFO", "KEY_SPECIFICS")
  }
  // Location → Time blocks → Customer name → Booking summary
  path.push("ADDRESS_CONTACT", "SCHEDULE_TIME", "CUSTOMER_NAME", "BOOKING_COMPLETE")
  return path
}

function previousWorkflowStep(path: WorkflowStep[], current: WorkflowStep): WorkflowStep | null {
  const idx = path.indexOf(current)
  if (idx <= 0) return null
  return path[idx - 1] ?? null
}

function IntakeStepProgress({ path, currentStep }: { path: WorkflowStep[]; currentStep: WorkflowStep }) {
  const currentIndex = Math.max(0, path.indexOf(currentStep))
  return (
    <div className="flex min-w-0 items-center gap-1.5 border-b border-border/60 px-4 py-1.5">
      {path.map((step, index) => {
        const active = step === currentStep
        const done = index < currentIndex
        return (
          <div
            key={step}
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
              active ? "bg-primary" : done ? "bg-primary/50" : "bg-muted"
            )}
            title={WORKFLOW_STEP_LABELS[step]}
          />
        )
      })}
      <span className="truncate text-xs font-semibold text-foreground">
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
  return (
    <div className="shrink-0 border-b border-border/60 px-3 pb-3.5 pt-2 pr-12">
      <div className="flex items-center gap-2">
        {onMinimize ? (
          <button
            type="button"
            onClick={onMinimize}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Minimize intake"
            title="Minimize"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {path.map((step, index) => {
            const active = step === currentStep
            const done = index < currentIndex
            return (
              <div
                key={step}
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                  active ? "bg-primary" : done ? "bg-primary/50" : "bg-muted"
                )}
                title={WORKFLOW_STEP_LABELS[step]}
              />
            )
          })}
          <span className="truncate text-xs font-semibold text-foreground">
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
        <p className="mt-1.5 mb-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
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
            🔄 Progress automatically restored.
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** After ring, poll ringing + answered APIs — backup when Pusher is slow. */
const RINGING_LOOKUP_DELAYS_MS = [0, 50, 150, 350]
/** While a call is ringing, poll quickly until answered_at lands in Neon. */
const RINGING_FAST_POLL_MS = 250
const RINGING_FAST_POLL_MAX_MS = 90_000
/** Safety net when Pusher is slow — only while the dashboard tab is visible. */
const ANSWERED_VISIBILITY_POLL_MS = 800
/** Blank failure-reason value — Radix Select cannot use an empty string. */
const FAILURE_REASON_NEUTRAL = "__neutral__"

/** True when intake is mid-call (answered / on hold) — secondary rings should not steal the sheet. */
function isIntakeCallActive(row: ActiveCallRow | null): boolean {
  if (!row) return false
  if (row.manualCallStatus === "answered" || row.manualCallStatus === "on_hold") return true
  if (row.manualCallStatus === "ringing" || row.manualCallStatus === "completed") return false
  return Boolean(row.answered_at)
}

function phoneDigitsKey(raw: string | null | undefined): string {
  const digits = normalizeCallEventPhoneDigits(raw)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
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
        caller_name: row.caller_name ?? prev.caller_name,
        recording_url: row.recording_url ?? prev.recording_url,
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
  }
}

function callLogRowFromApi(row: {
  id: string
  from_number: string
  to_number?: string | null
  caller_name?: string | null
  answered_at?: string | null
  recording_url?: string | null
}): ActiveCallRow {
  return {
    id: row.id,
    from_number: row.from_number,
    to_number: row.to_number ?? "",
    caller_name: row.caller_name ?? null,
    answered_at: row.answered_at ?? null,
    recording_url: row.recording_url ?? null,
  }
}

function fetchFirstUnseenRingingCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/ringing-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) return callLogRowFromApi(row)
      }
      return null
    })
    .catch(() => null)
}

function fetchFirstUnseenAnsweredCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/answered-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) {
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
    answered_at: new Date().toISOString(),
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
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null)
  const [draftPulse, setDraftPulse] = useState(false)
  const lastLoadedDraftPhoneRef = useRef<string | null>(null)
  const draftPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextDraftSaveRef = useRef(false)
  // Friendly flash when a prior draft is hydrated into the open sheet.
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
    resolvedPhoneNumber,
    patchForm,
    resetForm,
    setServiceQuoteTypeId,
    applyRapidLocksmithTemplate,
    setQuotedPriceDollars,
    syncQuotedPriceToAuto,
    liveQuote,
    travelDistanceMiles,
    dispatcherLocation,
    setVehicle,
    applyPlateLookupResult,
    applyVehicleClarification,
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

  const currentPriceVar = useMemo(() => {
    const parsed = Number.parseFloat(customPrice.trim())
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed)
    if (autoTotalDollars > 0) return autoTotalDollars
    return 120
  }, [customPrice, autoTotalDollars])

  const { step1Price, step2Price, step3Price } = useMemo(
    () => recoveryStepPrices(currentPriceVar),
    [currentPriceVar]
  )

  useEffect(() => {
    setNegotiationDiscountApplied(null)
    setNegotiationDiscountsTried([])
    setFailureReason(FAILURE_REASON_NEUTRAL)
    setRecoveredViaRouteDiscount(false)
    setHighlightConfirmBook(false)
    setNegotiationStep(1)
    setCurrentStep("SERVICE_SELECT")
    lastLoadedDraftPhoneRef.current = null
    // Reset attachments when a new call / ticket opens.
    setJobPhotos([])
    setRescueMeta(null)
    setGpsRequestState("idle")
    setDraftRestoredFlash(false)
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
    const raw = (form.phoneNumber.trim() || effectiveCurrent?.from_number || "").trim()
    return isValidIntakeDraftPhone(raw) ? raw : null
  }, [form.phoneNumber, effectiveCurrent?.from_number])

  /** Resume partial intake when the same customer calls back / sheet reopens. */
  useEffect(() => {
    if (!effectiveCurrent || !activeDraftPhone) return
    const normalized = normalizeIntakeDraftPhone(activeDraftPhone)
    if (!normalized || lastLoadedDraftPhoneRef.current === normalized) return

    // Prefer the restorable helper (fresh + not submitted).
    const draft = getDraftByPhoneNumber(activeDraftPhone)
    lastLoadedDraftPhoneRef.current = normalized
    if (!draft) return

    // Avoid immediately re-writing the same snapshot during hydrate.
    skipNextDraftSaveRef.current = true
    patchForm(draft.form)
    if (!draft.form.phoneNumber?.trim() && effectiveCurrent.from_number?.trim()) {
      patchForm({ phoneNumber: effectiveCurrent.from_number.trim() })
    }
    setCurrentStep(draft.currentStep as WorkflowStep)
    setCustomPrice(draft.customPrice)
    setFailureReason(draft.failureReason || FAILURE_REASON_NEUTRAL)
    setRecoveredViaRouteDiscount(draft.recoveredViaRouteDiscount)
    setNegotiationStep(draft.negotiationStep)
    setDraftRestoredFlash(true)
    if (draftRestoredTimerRef.current) window.clearTimeout(draftRestoredTimerRef.current)
    draftRestoredTimerRef.current = window.setTimeout(() => setDraftRestoredFlash(false), 4200)
  }, [effectiveCurrent, activeDraftPhone, patchForm])

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

    const timer = window.setTimeout(() => {
      saveIntakeDraft(activeDraftPhone, {
        form,
        currentStep,
        customPrice,
        failureReason,
        recoveredViaRouteDiscount,
        negotiationStep,
        submitted: false,
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
      setCustomPrice(autoTotalDollars > 0 ? String(autoTotalDollars) : "")
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

  const handleNegotiationApply = useCallback(
    (dollars: number, discountId: NegotiationDiscountId) => {
      setCustomPrice(String(dollars))
      setQuotedPriceDollars(dollars)
      setNegotiationDiscountApplied(discountId)
      setNegotiationDiscountsTried((prev) =>
        prev.includes(discountId) ? prev : [...prev, discountId]
      )
    },
    [setQuotedPriceDollars]
  )

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

  const applyRecoveryOffer = useCallback(
    (params: {
      dollars: number
      discountId: NegotiationDiscountId
      markRouteRecovery?: boolean
    }) => {
      setCustomPrice(String(params.dollars))
      setQuotedPriceDollars(params.dollars)
      setNegotiationDiscountApplied(params.discountId)
      setNegotiationDiscountsTried((prev) =>
        prev.includes(params.discountId) ? prev : [...prev, params.discountId]
      )
      if (params.markRouteRecovery) setRecoveredViaRouteDiscount(true)
      setFailureReason(FAILURE_REASON_NEUTRAL)
      setHighlightConfirmBook(true)
    },
    [setQuotedPriceDollars]
  )

  const handleApplyRouteMatchDiscount = useCallback(() => {
    applyRecoveryOffer({
      dollars: step1Price,
      discountId: "route_optimization",
      markRouteRecovery: true,
    })
  }, [applyRecoveryOffer, step1Price])

  const handleApplyAftermarketRecovery = useCallback(() => {
    applyRecoveryOffer({
      dollars: step2Price,
      discountId: "aftermarket_key_swap",
    })
  }, [applyRecoveryOffer, step2Price])

  const handleApplyManagementFloor = useCallback(() => {
    applyRecoveryOffer({
      dollars: step3Price,
      discountId: "first_time_callback",
    })
  }, [applyRecoveryOffer, step3Price])

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
      }
    },
    [
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

    const tryShowActiveCall = () => {
      void fetchFirstUnseenRingingCall(dismissedRef.current).then((ringing) => {
        if (cancelled) return
        if (ringing) {
          showCallRow(setCurrent, ringing, dismissedRef.current)
          return
        }
        void fetchFirstUnseenAnsweredCall(dismissedRef.current).then((answered) => {
          if (cancelled || !answered) return
          showCallRow(setCurrent, answered, dismissedRef.current)
          stopRingingFastPoll()
        })
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

    const pollId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      tryShowActiveCall()
    }, ANSWERED_VISIBILITY_POLL_MS)

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

    const onInitiated = (payload: OwnerCallInitiatedPayload) => {
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
        // Force New Intake open on every inbound ring (even if the sheet was minimized).
        dismissedRef.current.delete(row.id)
        if (payload.call_sid) dismissedRef.current.delete(`ring-${payload.call_sid}`)
        isMinimizedRef.current = false
        setIsMinimized(false)
        showCallRow(setCurrent, row, dismissedRef.current)
        scheduleRingingLookups()
      })
    }

    const onAnswered = (payload: OwnerCallAnsweredPayload) => {
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
        isMinimizedRef.current = false
        setIsMinimized(false)
        setCurrent((prev) => {
          if (prev?.id.startsWith("ring-") && phoneDigitsKey(prev.from_number) === phoneDigitsKey(row.from_number)) {
            ringAliasRef.current = prev.id
            dismissedRef.current.delete(prev.id)
          }
          return {
            ...row,
            caller_name: row.caller_name ?? prev?.caller_name ?? null,
          }
        })
      })
    }

    const onCompleted = (payload: OwnerCallCompletedPayload) => {
      const row = rowFromCompletedPayload(payload)
      if (!row) return
      showCallRow(setCurrent, row, dismissedRef.current)
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
  }, [form.phoneNumber, effectiveCurrent?.from_number])

  const resetIntakeUiState = useCallback(() => {
    resetForm()
    setCurrentStep("SERVICE_SELECT")
    setBookedLeadId(null)
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
    lastLoadedDraftPhoneRef.current = null
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

    // TODO: Activate automated booking confirmation SMS once 10DLC registration is fully approved.
    // await sendSmsConfirmation(phoneNumber, selectedTimeBlock, address);

    // Wipe the phone-keyed draft so the next call from this customer starts fresh.
    clearDraftForCurrentCaller()
    setBookedLeadId(result.leadId)
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
    const leadId = bookedLeadId
    closeIntakeAfterSave()
    if (leadId) router.push(buildSchedulerFocusUrl(leadId))
  }, [bookedLeadId, closeIntakeAfterSave, router])

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
    closeIntakeAfterSave()
    router.push(buildSchedulerFocusUrl(result.leadId, { schedule: true }))
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
    router.push("/dashboard/leads")
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

  const logLostLead = useCallback(async () => {
    if (!effectiveCurrent || !ownerUserId) return
    setLostLeadState("saving")
    setLostLeadError(null)
    try {
      const quotedPriceCents = resolveLostLeadQuoteCents()
      const res = await fetch("/api/leads/lost", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_log_id: effectiveCurrent.isManual ? null : effectiveCurrent.id,
          phone_number: form.phoneNumber.trim() || effectiveCurrent.from_number,
          last_quoted_price_cents: quotedPriceCents,
          baseline_quote_cents: liveQuote.totalCents > 0 ? liveQuote.totalCents : null,
          discount_applied: negotiationDiscountApplied,
          negotiation_discounts_tried: negotiationDiscountsTried,
          failure_reason: failureReason,
          vehicle_year: form.vehicleYear,
          vehicle_make: form.vehicleMake,
          vehicle_model: form.vehicleModel,
          service_type: liveQuote.dispatchJobTypeLabel,
          organization_id: activeOrganizationId,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log lost lead")
      setLostLeadState("saved")
      revalidateLeadsWorkspaceCache()
      void revalidateSchedulerJobPoolCaches(activeOrganizationId)
      window.setTimeout(() => dismissOnly(), 1200)
    } catch (e) {
      setLostLeadState("error")
      setLostLeadError(e instanceof Error ? e.message : "Could not log lost lead")
    }
  }, [
    activeOrganizationId,
    dismissOnly,
    effectiveCurrent,
    resolveLostLeadQuoteCents,
    failureReason,
    form.phoneNumber,
    form.vehicleMake,
    form.vehicleModel,
    form.vehicleYear,
    liveQuote.dispatchJobTypeLabel,
    liveQuote.totalCents,
    negotiationDiscountApplied,
    negotiationDiscountsTried,
    ownerUserId,
  ])

  const setManualCallStatus = useCallback(
    (status: ManualCallStatus) => {
      patchManualCallRow({
        manualCallStatus: status,
        answered_at: status === "ringing" ? null : effectiveCurrent?.answered_at ?? new Date().toISOString(),
      })
    },
    [effectiveCurrent?.answered_at, patchManualCallRow]
  )

  const handleManualServiceTypeChange = useCallback(
    (serviceType: ServiceQuoteTypeId) => {
      setServiceQuoteTypeId(serviceType)
      setCurrentStep(manualIntakeStepAfterService(serviceType))
    },
    [setServiceQuoteTypeId]
  )

  const handleRapidTemplate = useCallback(
    (template: "vehicle_lockout" | "home_lockout" | "rekey") => {
      applyRapidLocksmithTemplate(template)
      const nextType =
        template === "rekey" ? ("rekey" as ServiceQuoteTypeId) : ("lockout" as ServiceQuoteTypeId)
      setCurrentStep(manualIntakeStepAfterService(nextType))
      // Jump focus to address as soon as the address step is shown.
      window.setTimeout(() => {
        setCurrentStep("ADDRESS_CONTACT")
        window.setTimeout(() => addressSearchRef.current?.focus(), 80)
      }, 0)
    },
    [applyRapidLocksmithTemplate]
  )

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
        setCurrentStep("KEY_SPECIFICS")
      }
    },
    [setVehicle]
  )

  const handlePlateLookupSuccess = useCallback(
    (result: Parameters<typeof applyPlateLookupResult>[0] & {
      keyBundle?: PreloadedVehicleKeyBundle | null
    }) => {
      applyPlateLookupResult(result)
      if (result.keyBundle) setPreloadedKeyBundle(result.keyBundle)
      else setPreloadedKeyBundle(null)
      if (result.vehicle_model?.trim() || result.keyBundle?.model?.trim()) {
        setCurrentStep("KEY_SPECIFICS")
      }
    },
    [applyPlateLookupResult]
  )

  const handleManualKeyVariantSelected = useCallback(
    (selection: VehicleKeySelection) => {
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
        setCurrentStep("KEY_SPECIFICS")
      }
    },
    [setVehicle, patchForm]
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

  const serviceTypeId = (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId
  const manualPath = useMemo(() => manualWorkflowPath(serviceTypeId), [serviceTypeId])
  const isManual = Boolean(effectiveCurrent?.isManual)
  const isMobile = useIsMobile()
  /** Step-by-step intake on manual walk-ins and on mobile for real answered calls. */
  const stepIntake = isManual || isMobile

  const incomingPhone = form.phoneNumber || effectiveCurrent?.from_number || ""
  const repeatUrgency = useRepeatCallerUrgency(incomingPhone, effectiveCurrent?.id ?? null)
  const canAdvanceToSchedule = useMemo(
    () =>
      Boolean(
        addressReady ||
          isFlatAddressReadyForDispatch({ addressLine1: form.addressLine1, city: form.city })
      ),
    [form.addressLine1, form.city, addressReady]
  )

  const canAdvanceToCustomerName = useMemo(
    () => Boolean(form.scheduledDate.trim() && form.scheduledTime.trim()),
    [form.scheduledDate, form.scheduledTime]
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

  // Map overlay "← Return to Intake Form" — must register even when sheet is minimized.
  useEffect(() => {
    const onReturn = () => {
      consumePendingReturnToIntake()
      returnToIntakeFromMap()
    }
    window.addEventListener(LYNCR_RETURN_TO_INTAKE_EVENT, onReturn)
    // Catch a click that fired before this effect mounted.
    if (consumePendingReturnToIntake()) {
      returnToIntakeFromMap()
    }
    return () => {
      window.removeEventListener(LYNCR_RETURN_TO_INTAKE_EVENT, onReturn)
      if (suppressSheetDismissTimerRef.current) {
        window.clearTimeout(suppressSheetDismissTimerRef.current)
        suppressSheetDismissTimerRef.current = null
      }
    }
  }, [returnToIntakeFromMap])

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

  const isRinging =
    effectiveCurrent != null &&
    (effectiveCurrent.manualCallStatus === "ringing" ||
      (!effectiveCurrent.manualCallStatus && !effectiveCurrent.answered_at))
  const isPriceTooHigh = failureReason === "Price too high"
  const canLogLostLead = failureReason !== FAILURE_REASON_NEUTRAL
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
        className="flex h-[85vh] max-h-[750px] flex-col gap-0 overflow-hidden p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3"
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
          if (target?.closest("[data-address-suggestions]")) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (suppressSheetDismissRef.current) {
            e.preventDefault()
            return
          }
          const target = e.target as HTMLElement | null
          if (target?.closest("[data-return-to-intake]")) e.preventDefault()
        }}
      >
        {effectiveCurrent ? (
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
            <SheetHeader className="shrink-0 border-b border-border/60 px-4 pb-3 pr-12 pt-2 text-left">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={minimizeIntake}
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  aria-label="Minimize intake"
                  title="Minimize"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                {isRinging ? "Incoming call" : "Call answered"}
              </p>
              <SheetTitle className="flex flex-wrap items-center gap-2 text-left text-lg">
                <Phone
                  className={cn("h-5 w-5 shrink-0 text-primary", isRinging && "animate-pulse")}
                  aria-hidden
                />
                <span className="tabular-nums">
                  {formatPhoneDisplay(form.phoneNumber || effectiveCurrent.from_number)}
                </span>
                {repeatUrgency.isHighUrgency ? (
                  <RepeatCallerUrgencyBadge attemptCount={repeatUrgency.attemptCount} />
                ) : null}
              </SheetTitle>
                </div>
              </div>
              <IncomingCallOpsToolbar
                className="mt-2"
                phoneE164={form.phoneNumber || effectiveCurrent.from_number}
                businessLineE164={effectiveCurrent.to_number}
                callLogId={effectiveCurrent.id}
                organizationId={activeOrganizationId}
                isRinging={isRinging}
                onDeclined={dismissOnly}
                urgency={repeatUrgency}
              />
              {effectiveCurrent.recording_url ? (
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
            {stepIntake && !isManual ? (
              <IntakeStepProgress path={manualPath} currentStep={currentStep} />
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  stepIntake
                    ? "overflow-hidden px-4 py-2"
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
                            MANUAL_STEP_SCROLL,
                            "relative z-10",
                            // Extra bottom space so sticky footer does not cover model chips / key options.
                            (currentStep === "KEY_SPECIFICS" || currentStep === "VEHICLE_INFO") &&
                              "pb-32"
                          )}
                        >
                          {currentStep === "SERVICE_SELECT" ? (
                            <div className="space-y-3">
                              {matchedCustomer ? (
                                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200">
                                    Repeat Customer
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                                    {matchedCustomer.display_name?.trim() || "Known caller"}
                                  </p>
                                  {matchedCustomer.notes?.trim() ? (
                                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                      {matchedCustomer.notes.trim()}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  data-intake-primary-option
                                  onClick={() => handleRapidTemplate("vehicle_lockout")}
                                  className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                                >
                                  🚗 Vehicle Lockout
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRapidTemplate("home_lockout")}
                                  className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                                >
                                  🏠 Home Lockout
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRapidTemplate("rekey")}
                                  className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                                >
                                  🔑 Re-key / Fresh Install
                                </button>
                              </div>
                              <ServiceQuoteCalculatorPanel
                                quote={liveQuote}
                                serviceTypeId={serviceTypeId}
                                vehicleYear={form.vehicleYear}
                                vehicleMake={form.vehicleMake}
                                vehicleModel={form.vehicleModel}
                                onServiceTypeChange={handleManualServiceTypeChange}
                                variant="selector-only"
                                compact
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
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                Vehicle year · make · model
                              </legend>
                              <VehicleFastLookupField
                                plateNumber={form.plateNumber}
                                plateState={form.plateState}
                                vehicleVin={form.vehicleVin}
                                onPlateNumberChange={(plateNumber) => patchForm({ plateNumber })}
                                onPlateStateChange={(plateState) => patchForm({ plateState })}
                                onVinChange={(vehicleVin) => patchForm({ vehicleVin })}
                                onPlateSuccess={handlePlateLookupSuccess}
                                onVinSuccess={handleVehicleFromVin}
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Or pick year, make, then model manually — we still advance to key specifics.
                              </p>
                              <VehiclePickerCascade
                                variant="sequential"
                                value={{
                                  vehicle_year: form.vehicleYear,
                                  vehicle_make: form.vehicleMake,
                                  vehicle_model: form.vehicleModel,
                                }}
                                onChange={handleManualVehicleChange}
                              />
                            </fieldset>
                          ) : null}

                          {currentStep === "KEY_SPECIFICS" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                Key specifics
                              </legend>
                              {(form.vehicleYear || form.vehicleMake || form.vehicleModel) ? (
                                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400">
                                  Selected Vehicle: {[form.vehicleYear, form.vehicleMake, form.vehicleModel]
                                    .filter(Boolean)
                                    .join(" ")}
                                </div>
                              ) : null}
                              <CallTimeInventoryIntake
                                year={form.vehicleYear}
                                make={form.vehicleMake}
                                model={form.vehicleModel}
                                selectedFccId={form.keyFccId || null}
                                selectedFrequency={form.keyFrequency || null}
                                organizationId={activeOrganizationId}
                                inventory={preloadedKeyBundle?.inventory}
                                onInventoryUpdated={mergeInventoryItem}
                                onMarkedOutOfStock={() => {
                                  // Quantity set to 0 — Alternative Solutions card appears below.
                                  requestAnimationFrame(() => {
                                    document
                                      .getElementById("key-details-alternative-solutions")
                                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                                  })
                                }}
                              />
                              <p className="text-[11px] text-primary/90">
                                Verify button configuration with customer to confirm selection.
                              </p>
                              <VehicleIntakeClarificationsPanel
                                year={form.vehicleYear}
                                make={form.vehicleMake}
                                model={form.vehicleModel}
                                answeredIds={new Set(answeredClarificationIds)}
                                onAnswer={applyVehicleClarification}
                              />
                              <VehicleKeyInfoPanel
                                year={form.vehicleYear}
                                make={form.vehicleMake}
                                model={form.vehicleModel}
                                vehicleTrim={form.vehicleTrim}
                                factoryOptions={form.factoryOptions}
                                onVehicleTrimChange={(trim) => patchForm({ vehicleTrim: trim })}
                                fccId={form.keyFccId || null}
                                value={
                                  form.keyFccId
                                    ? {
                                        profileId: form.keyProfileId,
                                        fccId: form.keyFccId,
                                        frequency: form.keyFrequency || null,
                                        chipset: form.keyChipset || null,
                                        keyStyle: form.keyStyle || "Not sure yet",
                                        variantId: form.keyVariantId || null,
                                        programmingMethod: form.programmingMethod || null,
                                      }
                                    : null
                                }
                                onChange={(sel) => setVehicleKeySelection(sel)}
                                onVariantSelected={handleManualKeyVariantSelected}
                                onBackToVehicleLookup={() => setCurrentStep("VEHICLE_INFO")}
                                onVehicleFromVin={handleVehicleFromVin}
                                preloadedKeyBundle={preloadedKeyBundle}
                                onInventoryLoaded={(inventory) => {
                                  setPreloadedKeyBundle((prev) =>
                                    prev
                                      ? { ...prev, inventory }
                                      : {
                                          year: form.vehicleYear,
                                          make: form.vehicleMake,
                                          model: form.vehicleModel,
                                          key_info: null,
                                          lookup_source: null,
                                          inventory,
                                        }
                                  )
                                }}
                              />
                              <div id="key-details-alternative-solutions">
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
                                    router.push("/dashboard/leads")
                                  }}
                                />
                              </div>
                            </fieldset>
                          ) : null}

                          {currentStep === "ADDRESS_CONTACT" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                                Location &amp; address
                              </legend>
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
                                    Request Live GPS
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
                                <Button
                                  type="button"
                                  size="lg"
                                  className={cn(
                                    "mt-1 h-11 w-full font-semibold",
                                    !canAdvanceToSchedule && "opacity-50"
                                  )}
                                  disabled={!canAdvanceToSchedule}
                                  onClick={() => setCurrentStep("SCHEDULE_TIME")}
                                >
                                  {canAdvanceToSchedule
                                    ? "Continue to Schedule →"
                                    : "Enter a Service Address to Continue"}
                                </Button>
                              </div>
                            </fieldset>
                          ) : null}

                          {currentStep === "SCHEDULE_TIME" ? (
                            <div className="flex flex-col justify-start gap-4">
                              <div className={cn(WS_SECTION, "text-sm")}>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Time block &amp; schedule
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {[form.addressLine1, form.city, form.postalCode].filter(Boolean).join(", ") ||
                                    form.serviceAddress?.formatted ||
                                    "Service address selected"}
                                </p>
                              </div>

                              <ServiceQuoteCalculatorPanel
                                quote={liveQuote}
                                serviceTypeId={serviceTypeId}
                                vehicleYear={form.vehicleYear}
                                vehicleMake={form.vehicleMake}
                                vehicleModel={form.vehicleModel}
                                postalCode={form.postalCode || form.serviceAddress?.postal_code}
                                onServiceTypeChange={handleManualServiceTypeChange}
                                onEstimateChange={handleQuoteEstimateChange}
                                onFlatPriceChange={handleFlatPriceChange}
                                variant="breakdown-only"
                              />

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <Label htmlFor="intake-scheduled-date" className="text-xs">
                                    Appointment date <span className="text-primary">*</span>
                                  </Label>
                                  <Input
                                    id="intake-scheduled-date"
                                    type="date"
                                    value={form.scheduledDate}
                                    onChange={(e) => patchForm({ scheduledDate: e.target.value })}
                                    className="h-10"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="intake-scheduled-time" className="text-xs">
                                    Appointment time <span className="text-primary">*</span>
                                  </Label>
                                  <Input
                                    id="intake-scheduled-time"
                                    type="time"
                                    value={form.scheduledTime}
                                    onChange={(e) => patchForm({ scheduledTime: e.target.value })}
                                    className="h-10"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {currentStep === "CUSTOMER_NAME" ? (
                            <fieldset className={cn(WS_SECTION, "grid gap-4")}>
                              <legend className="px-1 text-sm font-semibold tracking-tight text-foreground">
                                Who are we assisting?
                              </legend>
                              <p className="text-xs text-muted-foreground">
                                Customer details — we&apos;ll lock the appointment under this name.
                              </p>
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
                              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                <p>
                                  {[form.addressLine1, form.city, form.postalCode].filter(Boolean).join(", ") ||
                                    form.serviceAddress?.formatted ||
                                    "—"}
                                </p>
                                <p className="mt-1 tabular-nums">
                                  {form.scheduledDate} · {form.scheduledTime}
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
                                  {form.scheduledDate} at {form.scheduledTime}
                                </p>
                              </div>
                              <p className="text-center text-[11px] text-muted-foreground">
                                Confirmation SMS will send automatically once 10DLC registration is approved.
                              </p>
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

                <PriceNegotiationHelperPanel
                  baselineCents={liveQuote.totalCents}
                  currentPriceDollars={customPrice}
                  onApplyPrice={handleNegotiationApply}
                  appliedDiscountId={negotiationDiscountApplied}
                />

                {requiresVehicle ? (
                  <fieldset className={cn(WS_SECTION, "grid gap-3")}>
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                      Vehicle metadata
                    </legend>
                    <p className="text-[11px] text-primary/90">
                      Get the vehicle before the service address. Tap the customer&apos;s answers below.
                    </p>
                    <VehicleFastLookupField
                      plateNumber={form.plateNumber}
                      plateState={form.plateState}
                      vehicleVin={form.vehicleVin}
                      onPlateNumberChange={(plateNumber) => patchForm({ plateNumber })}
                      onPlateStateChange={(plateState) => patchForm({ plateState })}
                      onVinChange={(vehicleVin) => patchForm({ vehicleVin })}
                      onPlateSuccess={handlePlateLookupSuccess}
                      onVinSuccess={handleVehicleFromVin}
                    />
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
                    <CallTimeInventoryIntake
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      selectedFccId={form.keyFccId || null}
                      selectedFrequency={form.keyFrequency || null}
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
                    <VehicleIntakeClarificationsPanel
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      answeredIds={new Set(answeredClarificationIds)}
                      onAnswer={applyVehicleClarification}
                    />
                    <VehicleKeyInfoPanel
                      year={form.vehicleYear}
                      make={form.vehicleMake}
                      model={form.vehicleModel}
                      vehicleTrim={form.vehicleTrim}
                      factoryOptions={form.factoryOptions}
                      onVehicleTrimChange={(trim) => patchForm({ vehicleTrim: trim })}
                      fccId={form.keyFccId || null}
                      value={
                        form.keyFccId
                          ? {
                              profileId: form.keyProfileId,
                              fccId: form.keyFccId,
                              frequency: form.keyFrequency || null,
                              chipset: form.keyChipset || null,
                              keyStyle: form.keyStyle || "Not sure yet",
                              variantId: form.keyVariantId || null,
                              programmingMethod: form.programmingMethod || null,
                            }
                          : null
                      }
                      onChange={(sel) => setVehicleKeySelection(sel)}
                      onVehicleFromVin={handleVehicleFromVin}
                      preloadedKeyBundle={preloadedKeyBundle}
                      onInventoryLoaded={(inventory) => {
                        setPreloadedKeyBundle((prev) =>
                          prev
                            ? { ...prev, inventory }
                            : {
                                year: form.vehicleYear,
                                make: form.vehicleMake,
                                model: form.vehicleModel,
                                key_info: null,
                                lookup_source: null,
                                inventory,
                              }
                        )
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
                          router.push("/dashboard/leads")
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
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ac-scheduled-date" className="text-xs">
                        Appointment date
                      </Label>
                      <Input
                        id="ac-scheduled-date"
                        type="date"
                        value={form.scheduledDate}
                        onChange={(e) => patchForm({ scheduledDate: e.target.value })}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ac-scheduled-time" className="text-xs">
                        Appointment time
                      </Label>
                      <Input
                        id="ac-scheduled-time"
                        type="time"
                        value={form.scheduledTime}
                        onChange={(e) => patchForm({ scheduledTime: e.target.value })}
                        className="h-10"
                      />
                    </div>
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
                      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200">
                        Repeat Customer
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">
                        {matchedCustomer.display_name?.trim() || "Known caller"}
                      </p>
                      {matchedCustomer.notes?.trim() ? (
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                          {matchedCustomer.notes.trim()}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRapidTemplate("vehicle_lockout")}
                      className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
                    >
                      🚗 Vehicle Lockout
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRapidTemplate("home_lockout")}
                      className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
                    >
                      🏠 Home Lockout
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRapidTemplate("rekey")}
                      className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
                    >
                      🔑 Re-key / Fresh Install
                    </button>
                  </div>
                </fieldset>

                <fieldset className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                    Price-shopper recovery
                  </legend>
                  {negotiationDiscountApplied || form.quotedPriceOverridden ? (
                    <p className="text-[11px] text-amber-100/90">
                      Last pitched quote: ${parseQuoteDollars(customPrice, liveQuote.totalCents)}
                      {negotiationDiscountApplied
                        ? ` (${negotiationDiscountLabel(negotiationDiscountApplied)})`
                        : ""}
                      {liveQuote.totalCents > 0
                        ? ` · baseline was $${Math.round(liveQuote.totalCents / 100)}`
                        : ""}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="failure-reason" className="text-xs">
                      Failure reason
                    </Label>
                    <Select value={failureReason} onValueChange={setFailureReason}>
                      <SelectTrigger id="failure-reason" className="h-9">
                        <SelectValue placeholder="Select failure reason" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FAILURE_REASON_NEUTRAL}>— Select reason —</SelectItem>
                        <SelectItem value="Price too high">Price too high</SelectItem>
                        <SelectItem value="Abrupt hang-up">Abrupt hang-up</SelectItem>
                        <SelectItem value="Shopping competitors">Shopping competitors</SelectItem>
                        <SelectItem value="Will call back later">Will call back later</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {isPriceTooHigh ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-orange-500/30 bg-slate-950 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">
                          Save the deal — read verbatim
                        </p>
                        <span className="shrink-0 text-[10px] font-medium text-orange-400/80">
                          Step {negotiationStep} of 3
                        </span>
                      </div>

                      {negotiationStep === 1 ? (
                        <>
                          <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                            <span className="mr-1" aria-hidden>
                              💬
                            </span>
                            &ldquo;{routeMatchRecoveryScript(step1Price)}&rdquo;
                          </p>
                          <Button
                            type="button"
                            size="lg"
                            className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                            onClick={handleApplyRouteMatchDiscount}
                          >
                            Apply Router Match Discount (${step1Price})
                          </Button>
                          <button
                            type="button"
                            className="w-full text-left text-xs text-orange-300 underline-offset-2 hover:text-orange-200 hover:underline"
                            onClick={() => setNegotiationStep(2)}
                          >
                            Customer declined this but is still negotiating →
                          </button>
                          {recoveredViaRouteDiscount ? (
                            <p className="text-[11px] text-emerald-300">
                              Route discount applied — confirm the job below when the customer accepts.
                            </p>
                          ) : null}
                        </>
                      ) : null}

                      {negotiationStep === 2 ? (
                        <>
                          <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                            <span className="mr-1" aria-hidden>
                              💬
                            </span>
                            &ldquo;{aftermarketRecoveryScript(step2Price)}&rdquo;
                          </p>
                          <Button
                            type="button"
                            size="lg"
                            className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                            onClick={handleApplyAftermarketRecovery}
                          >
                            Apply Aftermarket Hardware Swap (${step2Price})
                          </Button>
                          <div className="flex flex-col gap-1.5">
                            <button
                              type="button"
                              className="text-left text-xs text-slate-400 hover:text-slate-200"
                              onClick={() => setNegotiationStep(1)}
                            >
                              ← Go Back
                            </button>
                            <button
                              type="button"
                              className="text-left text-xs text-orange-300 underline-offset-2 hover:text-orange-200 hover:underline"
                              onClick={() => setNegotiationStep(3)}
                            >
                              Still too high but wants to book →
                            </button>
                          </div>
                        </>
                      ) : null}

                      {negotiationStep === 3 ? (
                        <>
                          <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                            <span className="mr-1" aria-hidden>
                              💬
                            </span>
                            &ldquo;{managementFloorRecoveryScript(form.displayName, step3Price)}&rdquo;
                          </p>
                          <Button
                            type="button"
                            size="lg"
                            className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                            onClick={handleApplyManagementFloor}
                          >
                            Apply Final Management Floor (${step3Price})
                          </Button>
                          <button
                            type="button"
                            className="text-left text-xs text-slate-400 hover:text-slate-200"
                            onClick={() => setNegotiationStep(2)}
                          >
                            ← Go Back
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full gap-2 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
                    disabled={lostLeadState === "saving" || !canLogLostLead}
                    onClick={() => void logLostLead()}
                  >
                    {lostLeadState === "saving" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <PhoneOff className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    Customer declined price / hang up
                  </Button>
                  {lostLeadState === "saved" ? (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      Lost lead logged — recovery SMS will queue after 20 minutes.
                    </p>
                  ) : null}
                  {lostLeadError ? <p className="text-xs text-red-300">{lostLeadError}</p> : null}
                </fieldset>
                  </>
                )}
              </div>

              <div className="sticky bottom-0 shrink-0 space-y-1.5 border-t border-slate-800 bg-slate-900 p-2">
                {stepIntake ? (
                  <>
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
                          variant={form.keyVariantId.trim() ? "outline" : "default"}
                          size="lg"
                          className="h-11 min-w-0 flex-1"
                          onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                        >
                          {form.keyVariantId.trim()
                            ? "Continue to location"
                            : "Next: Location & Contact"}
                        </Button>
                      </div>
                    ) : null}
                    {currentStep === "ADDRESS_CONTACT" ? (
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
                            !canAdvanceToSchedule && "opacity-50"
                          )}
                          disabled={!canAdvanceToSchedule}
                          onClick={() => setCurrentStep("SCHEDULE_TIME")}
                        >
                          {canAdvanceToSchedule
                            ? "Continue to Schedule →"
                            : "Enter a Service Address to Continue"}
                        </Button>
                      </div>
                    ) : null}
                    {currentStep === "SCHEDULE_TIME" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-11 shrink-0"
                          onClick={() => setCurrentStep("ADDRESS_CONTACT")}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          size="lg"
                          className={cn(
                            "h-11 min-w-0 flex-1 font-semibold",
                            !canAdvanceToCustomerName && "opacity-50"
                          )}
                          disabled={!canAdvanceToCustomerName}
                          onClick={() => {
                            // Flush the quote-card total into the ticket before advancing.
                            applyCustomPriceToForm()
                            setCurrentStep("CUSTOMER_NAME")
                          }}
                        >
                          {canAdvanceToCustomerName
                            ? "Continue to Customer Details →"
                            : "Pick Date & Time to Advance"}
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
                          onClick={() => setCurrentStep("SCHEDULE_TIME")}
                        >
                          Back to schedule
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
                            onClick={() => void confirmAndBook()}
                          >
                            {jobState === "creating" ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : null}
                            Finalize &amp; Secure Appointment →
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
                        {!canDispatch && jobState !== "creating" && dispatchBlockers.length > 0 ? (
                          <p className="text-center text-[10px] text-amber-200/90">
                            Still needed: {dispatchBlockers.join(" · ")}
                          </p>
                        ) : null}
                        {jobError ? <p className="text-[11px] text-red-300">{jobError}</p> : null}
                      </>
                    ) : null}
                    {currentStep === "BOOKING_COMPLETE" ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          size="lg"
                          className="h-11 w-full font-semibold"
                          onClick={finishBookingAndOpenScheduler}
                        >
                          Open on Scheduler
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-11 w-full"
                          onClick={dismissWithDraftClear}
                        >
                          Done
                        </Button>
                      </div>
                    ) : null}
                    {(currentStep === "VEHICLE_INFO" || currentStep === "SERVICE_SELECT") &&
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
                    {currentStep === "VEHICLE_INFO" &&
                    form.vehicleYear.trim() &&
                    form.vehicleMake.trim() &&
                    form.vehicleModel.trim() ? (
                      <Button
                        type="button"
                        size="lg"
                        className="h-11 w-full"
                        onClick={() => setCurrentStep("KEY_SPECIFICS")}
                      >
                        Next: Key details
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
          </>
        ) : null}
      </SheetContent>
    </Sheet>
    </>
  )
}
