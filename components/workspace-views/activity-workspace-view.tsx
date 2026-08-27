"use client"

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { WorkspaceFilterPills } from "@/components/workspace-filter-pills"
import { useRecentArrivals } from "@/lib/hooks/use-recent-arrivals"
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  PhoneMissed,
  UserRound,
} from "lucide-react"
import { CustomerSmsComposer } from "@/components/messaging/customer-sms-composer"
import { SendBookLinkButton } from "@/components/activity/send-book-link-sheet"
import { cn } from "@/lib/utils"
import { buildTelHref, toE164 } from "@/lib/phone-e164"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { isMissedCallRecord, isMissedCallTodayRecord, isIvrMenuHandler, type MissedCallRecordInput } from "@/lib/missed-call-telemetry"
import {
  CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
  CAPTURE_STATUS_BUSY_LINK,
  CAPTURE_STATUS_BUSY_MENU,
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_FULL_DAY_LINK,
  CAPTURE_STATUS_HOLD_PRESS1,
  CAPTURE_STATUS_HOLD_QUEUE,
  CAPTURE_STATUS_NIGHT_LINK,
  isAnsweredFromQueueStatus,
  isHoldAutomationStatus,
} from "@/lib/inbound-time-capture"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import type { CallActivityContext } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useWorkspacePhoneLines } from "@/lib/hooks/use-workspace-phone-lines"
import { scopeCallsToShopLines } from "@/lib/workspace-phone-lines"
import {
  DrawerStepHeader,
  DrawerScrollBody,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  ActivityStatusPill,
  activityRowAccentClass,
  isHoldActivityStatus,
  isMissedActivityStatus,
  WORKSPACE_TABLE_ROW_CLASS,
  type ActivityCallStatus,
} from "@/components/dashboard-workspace-ui"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"
import {
  ClientSearchParamsBridge,
  readWindowSearchQuery,
  searchQueryToParams,
} from "@/components/client-search-params-bridge"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { shouldPlayOperatorDispositionAlert } from "@/lib/admin-notification-client"
import {
  useOperationsData,
  type UiCallRecord,
} from "@/lib/hooks/use-operations-data"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import {
  formatListDateLabel,
  formatListTimeLabel,
  resolveOwnerTimezone,
} from "@/lib/browser-timezone-cookie"
import {
  filterActivityCallGroups,
  formatGroupedCallCountLabel,
  formatGroupedCallSummary,
  groupCallsByPhoneAndDay,
  pickGroupJobActivityCall,
  type GroupedActivityCall,
} from "@/lib/activity-call-groups"
import {
  buildBusinessLineLabelMap,
  resolveBusinessLineLabel,
  type LineLabelEntry,
} from "@/lib/line-display"

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

function formatCallerNumber(num: string | null): string {
  if (!num) return "Unknown caller"
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num
}

/** Short two-tone chime for a new booking — synthesized so we ship no audio asset. */
function playBookingPing() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34)
    osc.start()
    osc.stop(ctx.currentTime + 0.36)
    osc.onended = () => void ctx.close()
  } catch {
    /* audio not available — toast still fires */
  }
}

type BookingAlert = { id: string; caller: string | null; summary: string | null; created_at: string }

/** Poll for newly-BOOKED operator jobs and fire a toast + audio ping for each. */
function useBookingAlerts(enabled: boolean) {
  const { toast } = useToast()
  const session = useDashboardSessionOptional()
  const [noisyAlerts, setNoisyAlerts] = useState(() =>
    shouldPlayOperatorDispositionAlert(session)
  )
  const sinceRef = useRef<string>(new Date().toISOString())
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setNoisyAlerts(shouldPlayOperatorDispositionAlert(session))
  }, [session?.isPlatformAdmin, session?.adminNotificationPreferences])

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const prefs = (
        e as CustomEvent<{
          preferences?: NonNullable<typeof session>["adminNotificationPreferences"]
        }>
      ).detail?.preferences
      if (!prefs) return
      setNoisyAlerts(prefs.push_operator_dispositions !== false)
    }
    window.addEventListener("zing-admin-notification-preferences-changed", onPrefs)
    return () => window.removeEventListener("zing-admin-notification-preferences-changed", onPrefs)
  }, [session])

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    async function poll() {
      try {
        const res = await fetch(`/api/owner/booking-alerts?since=${encodeURIComponent(sinceRef.current)}`, {
          credentials: "include",
          cache: "no-store",
        })
        if (!res.ok) return
        const json = (await res.json()) as { data?: { bookings?: BookingAlert[]; now?: string } }
        for (const b of json.data?.bookings ?? []) {
          if (seenRef.current.has(b.id)) continue
          seenRef.current.add(b.id)
          if (noisyAlerts) {
            playBookingPing()
            toast({
              title: "New booking confirmed",
              description: `${formatCallerNumber(b.caller)}${b.summary ? ` — ${b.summary}` : ""}`,
            })
          }
        }
        if (json.data?.now) sinceRef.current = json.data.now
      } catch {
        /* transient — next tick retries */
      }
    }
    const timer = window.setInterval(() => {
      if (!stopped) void poll()
    }, 12_000)
    void poll()
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [toast, noisyAlerts, enabled])
}

/** Split call time into a scannable day label + clock time. */
function formatCallTimestampParts(call: UiCallRecord): { day: string; time: string; full: string } | null {
  // Prefer stored labels from SSR / fetch — recomputing from createdAt used the
  // server clock (UTC) on first HTML, then the phone clock after hydrate (time flip).
  if (call.date && call.time) {
    return { day: call.date, time: call.time, full: `${call.date}, ${call.time}` }
  }
  if (call.createdAt) {
    const d = new Date(call.createdAt)
    if (!Number.isNaN(d.getTime())) {
      const tz = resolveOwnerTimezone()
      const time = formatListTimeLabel(d, tz)
      const day = formatListDateLabel(d, tz)
      return { day, time, full: `${day}, ${time}` }
    }
  }
  return null
}

/** e.g. "Today, 4:15 PM" or "May 25, 2:30 PM" */
function formatCallTimestamp(call: UiCallRecord): string {
  return formatCallTimestampParts(call)?.full ?? "—"
}

function CallTimeDisplay({
  call,
  variant = "compact",
}: {
  call: UiCallRecord
  variant?: "compact" | "prominent" | "inline"
}) {
  const parts = formatCallTimestampParts(call)
  if (!parts) {
    return <span className="text-xs text-zinc-600">—</span>
  }
  // Single-line time for dense collapsed activity rows.
  if (variant === "inline") {
    return (
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400" title={parts.full}>
        {parts.time}
        {parts.day && parts.day !== "Today" ? (
          <span className="font-medium text-zinc-600"> · {parts.day}</span>
        ) : null}
      </span>
    )
  }
  if (variant === "prominent") {
    return (
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right" title={parts.full}>
        <span className="flex items-center gap-1 text-sm font-semibold tabular-nums text-zinc-100">
          <Clock className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          {parts.time}
        </span>
        <span className="text-[11px] font-medium text-zinc-500">{parts.day}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5" title={parts.full}>
      <span className="text-sm font-semibold tabular-nums text-zinc-200">{parts.time}</span>
      <span className="text-[11px] font-medium text-zinc-500">{parts.day}</span>
    </div>
  )
}

/** Human label for who/what answered the call. */
function formatRoutedToLabel(routedTo: string): string {
  const raw = routedTo.trim()
  if (!raw) return "Routed to owner"
  // Hold / press-1 — show the Activity card label as-is (already owner-friendly).
  if (/booked from hold/i.test(raw) || /hold · press/i.test(raw)) return raw
  if (/^hold queue$/i.test(raw)) return "Hold queue"
  if (/^owner$/i.test(raw)) return "Routed to owner"
  if (/ai receptionist|voice ai|assistant/i.test(raw)) return "Routed to AI receptionist"
  if (/receptionist/i.test(raw)) return raw.replace(/^routed to\s+/i, "") || "Routed to receptionist"
  return `Routed to ${raw}`
}

function missedRecordFromUiCall(call: UiCallRecord): MissedCallRecordInput {
  return {
    call_type: call.rawCallType || call.type,
    status: call.callStatus,
    answered_at: call.answeredAt,
    ended_at: call.endedAt,
    routed_to_name: call.routedTo,
    duration_seconds: call.durationSeconds,
  }
}

function classifyCall(call: UiCallRecord): ActivityCallStatus {
  const routed = call.routedTo ?? ""
  if (routed === CAPTURE_STATUS_EMERGENCY_ANSWERED) return "emergency"
  if (isAnsweredFromQueueStatus(routed) || routed === CAPTURE_STATUS_ANSWERED_FROM_QUEUE) {
    return "answered_from_queue"
  }
  if (routed === CAPTURE_STATUS_HOLD_PRESS1 || /booked from hold/i.test(routed)) {
    return "hold_press1"
  }
  if (routed === CAPTURE_STATUS_HOLD_QUEUE || /^hold queue$/i.test(routed)) {
    return "hold_queue"
  }
  if (routed === CAPTURE_STATUS_BUSY_MENU || /busy · hold menu/i.test(routed)) {
    return "busy_menu"
  }
  if (routed === CAPTURE_STATUS_NIGHT_LINK) return "night_link"
  if (routed === CAPTURE_STATUS_DAY_LINK) return "day_link"
  if (routed === CAPTURE_STATUS_FULL_DAY_LINK) return "day_off_link"
  if (routed === CAPTURE_STATUS_BUSY_LINK) return "busy_link"
  if (call.type === "voicemail" || /voicemail/i.test(routed)) return "voicemail"
  // IVR / keypad — amber Missed (IVR), never green Answered.
  if (isIvrMenuHandler(routed) && !isHoldAutomationStatus(routed)) return "missed_ivr"
  if (/ai receptionist|voice ai|assistant/i.test(routed)) return "ai_handled"
  // Your Phone / human answer — requires answered_at (or shared missed rules say not missed).
  if (!isMissedCallRecord(missedRecordFromUiCall(call)) && Boolean(call.answeredAt)) {
    return "answered"
  }
  if (isMissedCallRecord(missedRecordFromUiCall(call))) {
    return isIvrMenuHandler(routed) ? "missed_ivr" : "missed"
  }
  if (call.type === "missed") return "missed"
  return "missed"
}

type ActivityCallFilter = "all" | "missed" | "hold" | "press1"

function isMissedActivityCall(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  const status = classifyCall(call)
  return (
    status === "missed" ||
    status === "missed_ivr" ||
    status === "voicemail" ||
    status === "ai_handled" ||
    status === "night_link" ||
    status === "day_link" ||
    status === "day_off_link" ||
    status === "busy_link"
  )
}

function isHoldFilterCall(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  const st = classifyCall(call)
  return st === "hold_queue" || st === "busy_menu" || st === "answered_from_queue"
}

function isPress1FilterCall(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  return classifyCall(call) === "hold_press1"
}

/** Same rules as the Lines HUD “Missed today” pill — local calendar day + shared missed detection. */
function isMissedActivityCallToday(call: UiCallRecord, now: Date = new Date()): boolean {
  if (call.type === "outgoing") return false
  return isMissedCallTodayRecord(
    { ...missedRecordFromUiCall(call), created_at: call.createdAt || null },
    now
  )
}

/** Any inbound call with a dialable customer number — not only missed. */
function canCallBack(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  const raw = call.callerNumber?.trim()
  if (!raw || raw === "—") return false
  return buildTelHref(raw) != null
}

/** Missed or empty intake — Call back should dial + open the intake draft sheet. */
function needsRevenueRescue(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  if (isMissedActivityCall(call)) return true
  const action = call.activity?.intakeAction
  return !action || action === "No intake recorded"
}

/** Open intake for this activity row — quick note for missed, full wizard for answered. */
function openIntakeForActivityCall(
  inbound: ReturnType<typeof useInboundCallPanelOptional>,
  call: UiCallRecord
) {
  // No panel provider (e.g. outside dashboard shell) — nothing to open.
  if (!inbound) return
  const trimmed = call.callerNumber?.trim() || ""
  // Need a dialable caller to seed the sheet.
  if (!trimmed || trimmed === "—") return
  const name = call.callerName?.trim() || ""
  // Missed → one-screen purpose/notes; answered no-intake → full booking sheet.
  const missed = isMissedActivityCall(call)
  inbound.openManualCallPanel({
    // E.164 when possible so SMS / booking match the call log.
    phoneNumber: toE164(trimmed) || trimmed,
    // Skip placeholder names so the name step still asks.
    customerName:
      name && name !== "Unknown Caller" && name !== "—" ? name : undefined,
    callStatus: missed ? "completed" : "answered",
    // Business line the customer dialed (helps SMS from-line).
    toNumber: call.targetLineE164?.trim() || undefined,
    // Bind book / lost-lead to this call_logs row (not a new manual-* id).
    callLogId: call.id,
    answeredAt: call.answeredAt || call.createdAt || null,
    // If Activities already linked a lead, complete that row instead of duplicating.
    leadId: call.activity?.leadId || undefined,
    intakeMode: missed ? "quick" : "full",
  })
}

/** @deprecated Prefer openIntakeForActivityCall — kept for phone-only badge taps. */
function openIntakeDraftForPhone(
  inbound: ReturnType<typeof useInboundCallPanelOptional>,
  phone: string
) {
  if (!inbound) return
  const trimmed = phone.trim()
  if (!trimmed || trimmed === "—") return
  inbound.openManualCallPanel({
    phoneNumber: toE164(trimmed) || trimmed,
    callStatus: "answered",
  })
}

/** True when row click should open answered intake instead of the read-only log sheet. */
function shouldOpenIntakeOnActivityClick(call: UiCallRecord): boolean {
  // Outgoing logs stay read-only (no customer intake).
  if (call.type === "outgoing") return false
  // Need a phone to fill the answered modal.
  if (!canCallBack(call)) return false
  // Missed or unanswered intake → open the full purpose / outcome sheet.
  return needsRevenueRescue(call)
}

/** Row tap: answered intake when needed; otherwise the SMS / recording log sheet. */
function openActivityCallFromList(
  call: UiCallRecord,
  inbound: ReturnType<typeof useInboundCallPanelOptional>,
  openLogSheet: (call: UiCallRecord) => void
) {
  if (shouldOpenIntakeOnActivityClick(call)) {
    openIntakeForActivityCall(inbound, call)
    return
  }
  openLogSheet(call)
}

function CallBackButton({
  phone,
  className,
  compact = false,
  /** When true: dial native tel: and open intake draft in parallel (missed / no intake). */
  openIntakeDraft = false,
  /** When set with openIntakeDraft, binds intake to this call_logs row. */
  intakeCall,
  /** Missed rows use rose “Call back” so they don’t match answered teal Call. */
  missed = false,
  /** Hold / press-1 rows use amber “Call back”. */
  hold = false,
}: {
  phone: string
  className?: string
  compact?: boolean
  openIntakeDraft?: boolean
  intakeCall?: UiCallRecord
  missed?: boolean
  hold?: boolean
}) {
  const inbound = useInboundCallPanelOptional()
  const href = buildTelHref(phone)
  if (!href) return null

  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Parallel: open intake draft sheet + fire native dialer.
    if (openIntakeDraft) {
      if (intakeCall) openIntakeForActivityCall(inbound, intakeCall)
      else openIntakeDraftForPhone(inbound, phone)
    }
    window.location.href = href
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98]",
        missed
          ? "border-rose-500/45 bg-rose-500/15 text-rose-100 hover:border-rose-400/60 hover:bg-rose-500/25"
          : hold
            ? "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:border-amber-400/55 hover:bg-amber-500/20"
            : "border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:border-teal-400/50 hover:bg-slate-800 hover:text-teal-300",
        compact ? "h-8 px-3 text-[11px]" : "min-h-11 w-full px-4 py-3 text-sm",
        className
      )}
    >
      <Phone className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      {/* Missed/hold: always “Call back”; answered compact list stays short “Call”. */}
      {missed || hold || !compact ? "Call back" : "Call"}
    </a>
  )
}

function ActivityCallFilterBar({
  filter,
  missedCount,
  holdCount,
  press1Count,
  onChange,
}: {
  filter: ActivityCallFilter
  missedCount: number
  holdCount: number
  press1Count: number
  onChange: (next: ActivityCallFilter) => void
}) {
  return (
    <WorkspaceFilterPills
      layoutId="lyncr-activity-filter-pill"
      aria-label="Call list filter"
      value={filter}
      onChange={(id) => onChange(id as ActivityCallFilter)}
      items={[
        { id: "all", label: "All activity", tone: "primary" },
        {
          id: "missed",
          label: "Missed today",
          badge: missedCount,
          tone: "amber",
          icon: <PhoneMissed className="h-3.5 w-3.5 shrink-0" aria-hidden />,
        },
        { id: "hold", label: "Hold", badge: holdCount, tone: "amber" },
        { id: "press1", label: "Press 1", badge: press1Count, tone: "amber" },
      ]}
    />
  )
}

/** Short actions timeline for expanded Activity rows (hold / press-1 / answer). */
function buildCallActionsTimeline(call: UiCallRecord): string[] {
  const st = classifyCall(call)
  const lines: string[] = []
  if (st === "busy_menu") {
    lines.push("Entered Busy menu (press 1 or stay on the line)")
  }
  if (st === "hold_queue" || st === "answered_from_queue") {
    lines.push("Entered hold queue")
  }
  if (st === "hold_press1") {
    lines.push("Press 1 · booking text sent")
  }
  if (st === "answered_from_queue") {
    lines.push("Answered from queue")
  }
  if (st === "answered" || st === "emergency") {
    const who = (call.routedTo || "").trim()
    lines.push(who ? `Answered by ${who}` : "Answered")
  }
  const action = call.activity?.intakeAction
  if (action && action !== "No intake recorded" && action !== "Pending time") {
    lines.push(action)
  }
  if (call.activity?.intakeDetail) {
    lines.push(call.activity.intakeDetail)
  }
  if (lines.length === 0 && isMissedActivityStatus(st)) {
    lines.push("No answer · no hold / press-1 handling")
  }
  return lines
}

type CallAgent = { label: string; kind: "operator" | "ai" | "owner" | "none" }

/** Resolve who handled the call traffic for the Agent badge. */
function resolveCallAgent(call: UiCallRecord): CallAgent {
  const st = classifyCall(call)
  const routed = (call.routedTo ?? "").trim()
  if (st === "voicemail") return { label: "Voicemail", kind: "none" }
  if (st === "hold_press1") return { label: "Press 1 SMS", kind: "none" }
  if (st === "hold_queue" || st === "busy_menu") return { label: "Hold queue", kind: "none" }
  if (st === "answered_from_queue") return { label: "You (from queue)", kind: "owner" }
  if (st === "missed") return { label: "Unanswered", kind: "none" }
  if (st === "ai_handled" || /ai receptionist|voice ai|assistant/i.test(routed)) {
    return { label: "Lyncr AI", kind: "ai" }
  }
  if (!routed || /^owner$/i.test(routed) || /\byou\b/i.test(routed)) {
    return { label: "You", kind: "owner" }
  }
  const name = routed.replace(/^routed to\s+/i, "").trim() || "Operator"
  return { label: name, kind: "operator" }
}

function AgentBadge({
  agent,
  /** Table cells: short label only so the badge is not truncated to “Ans…”. */
  compact = false,
}: {
  agent: CallAgent
  compact?: boolean
}) {
  if (agent.kind === "none") {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-800/40 px-2 py-0.5 text-[11px] font-medium text-zinc-500"
        title={agent.label}
      >
        {agent.label}
      </span>
    )
  }
  const tone =
    agent.kind === "ai"
      ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-300"
      : agent.kind === "owner"
        ? "border-primary/35 bg-primary/10 text-primary"
        : "border-violet-500/40 bg-violet-500/10 text-violet-300"
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone
      )}
      title={`Answered by: ${agent.label}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          agent.kind === "ai" ? "bg-cyan-400" : agent.kind === "owner" ? "bg-primary" : "bg-violet-400"
        )}
        aria-hidden
      />
      <span className="truncate">{compact ? agent.label : `Answered by: ${agent.label}`}</span>
    </span>
  )
}

/** Plain-language recap of who handled the call and what was captured. */
function buildCallSummary(call: UiCallRecord): string {
  const st = classifyCall(call)
  const dur = formatDuration(call.durationSeconds)
  const caller = `${call.callerName} (${call.callerNumber})`
  if (st === "hold_press1") {
    return `${caller} chose Press 1 while you were Busy — a booking text was sent. Duration ${dur}.`
  }
  if (st === "hold_queue") {
    return `${caller} waited in the hold queue (${dur}) and left before someone Answered from Lines.`
  }
  if (st === "busy_menu") {
    return `${caller} reached your Busy menu (${dur}) and hung up before press 1 or hold.`
  }
  if (st === "answered_from_queue") {
    return `${caller} was Answered from the hold queue. The conversation lasted ${dur}.`
  }
  const agent = resolveCallAgent(call)
  if (agent.kind === "none") {
    return call.type === "voicemail"
      ? `${caller} reached your line and left a voicemail. No live operator picked up — follow up to recover this lead.`
      : `${caller} called your line but the call went unanswered. Consider returning the call to recover this lead.`
  }
  const who =
    agent.kind === "ai"
      ? "the Lyncr AI receptionist"
      : agent.kind === "owner"
        ? "you directly"
        : `Lyncr operator ${agent.label}`
  return `${caller} called in and was answered by ${who}. The conversation lasted ${dur}. The caller's request and any details collected during the call are noted below for your follow-up.`
}

function intakeActionTone(action: string): string {
  if (action === "Sent to dispatch" || action === "Booked") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
  }
  if (action === "Contact saved" || action === "Pending time") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200"
  }
  if (action === "Price rejected" || action === "Failed") {
    return "border-red-500/35 bg-red-500/10 text-red-300"
  }
  if (action === "No intake recorded") {
    return "border-zinc-700/70 bg-zinc-800/40 text-zinc-500"
  }
  return "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
}

function ActivityIntakeSummary({
  activity,
  compact = false,
  /** When set, "No intake recorded" becomes a tap target that opens intake draft (no dial). */
  callerPhone,
  /** Full call row — preferred so intake binds to call_logs.id. */
  call,
}: {
  activity: CallActivityContext
  compact?: boolean
  callerPhone?: string
  call?: UiCallRecord
}) {
  const inbound = useInboundCallPanelOptional()
  const schedulerHref = activity.leadId
    ? buildSchedulerFocusUrl(activity.leadId, { schedule: !activity.scheduleAt })
    : null
  const isNoIntake = activity.intakeAction === "No intake recorded"
  const canOpenIntakeDraft = Boolean(isNoIntake && inbound && (call || callerPhone))

  const displayAction =
    compact && isNoIntake ? "No intake" : activity.intakeAction

  return (
    <div className={cn("space-y-1", compact && "space-y-0.5")}>
      {canOpenIntakeDraft ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (call) openIntakeForActivityCall(inbound, call)
            else if (callerPhone) openIntakeDraftForPhone(inbound, callerPhone)
          }}
          className={cn(
            "inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[10px] font-medium",
            compact ? "normal-case tracking-normal" : "uppercase tracking-wide font-semibold rounded-full",
            intakeActionTone(activity.intakeAction),
            "cursor-pointer transition-[color,background-color,border-color,filter] duration-150 hover:border-teal-400/40 hover:bg-slate-800 hover:text-teal-300 hover:brightness-110"
          )}
          aria-label="Log what this call was for"
        >
          {displayAction}
        </button>
      ) : (
        <span
          className={cn(
            "inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[10px] font-medium",
            compact ? "normal-case tracking-normal" : "uppercase tracking-wide font-semibold rounded-full",
            intakeActionTone(activity.intakeAction)
          )}
        >
          {displayAction}
        </span>
      )}
      {activity.intakeDetail ? (
        <p className={cn("text-zinc-400", compact ? "text-[11px] leading-snug line-clamp-2" : "text-xs leading-relaxed")}>
          {activity.intakeDetail}
        </p>
      ) : null}
      {activity.scheduleLabel ? (
        <p className={cn("flex items-center gap-1 text-emerald-300/90", compact ? "text-[11px]" : "text-xs")}>
          <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
          <span>{activity.scheduleLabel}</span>
        </p>
      ) : null}
      {activity.callerScheduleHint ? (
        <p className={cn("text-zinc-500", compact ? "text-[10px]" : "text-[11px]")}>{activity.callerScheduleHint}</p>
      ) : null}
      {schedulerHref ? (
        <Link
          href={schedulerHref}
          className={cn(
            "inline-flex items-center gap-1 font-medium text-cyan-400 underline-offset-2 transition-colors duration-150 hover:text-teal-300 hover:underline",
            compact ? "text-[11px]" : "text-xs"
          )}
        >
          <MapPin className="h-3 w-3" aria-hidden />
          Open in scheduler
        </Link>
      ) : null}
    </div>
  )
}

function CallLogSheet({ call, onClose }: { call: UiCallRecord; onClose: () => void }) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const inbound = useInboundCallPanelOptional()
  const agent = resolveCallAgent(call)
  const summary = buildCallSummary(call)
  const showCallBack = canCallBack(call)
  const callStatus = classifyCall(call)
  const isMissedLog = isMissedActivityStatus(callStatus)
  const isHoldLog = isHoldActivityStatus(callStatus) || callStatus === "hold_press1"
  // Same dial-first rule as Activity list: Missed + Busy / Hold / Press 1.
  const dialFirst = (isMissedLog || isHoldLog) && showCallBack
  const activity = call.activity ?? {
    intakeAction: "No intake recorded",
    intakeDetail: null,
    scheduleLabel: null,
    scheduleAt: null,
    leadId: null,
    callerScheduleHint: null,
    callerPoolCount: 0,
  }
  const hasIntake =
    Boolean(activity.leadId) ||
    (Boolean(activity.intakeAction) && activity.intakeAction !== "No intake recorded")
  const canCompleteIntake = needsRevenueRescue(call) && Boolean(inbound)
  const schedulerHref = activity.leadId
    ? buildSchedulerFocusUrl(activity.leadId, { schedule: !activity.scheduleAt })
    : null
  const customerPhone = call.callerNumber.trim()
  const canText = Boolean(toE164(customerPhone) || customerPhone.replace(/\D/g, "").length >= 10)
  const messagesHref = canText
    ? `/dashboard/messages?phone=${encodeURIComponent(customerPhone)}`
    : "/dashboard/messages"

  return (
    <>
      <DrawerStepHeader
        step="Log"
        title={isMissedLog ? "Missed call" : "Call detail"}
        subtitle={`${call.callerName} · ${call.callerNumber}`}
      />
      <DrawerScrollBody>
        <div className="space-y-3">
          {/* Dial-first: Call back is the only loud primary; note lands in the quiet row. */}
          {!dialFirst && canCompleteIntake ? (
            <button
              type="button"
              onClick={() => {
                openIntakeForActivityCall(inbound, call)
                onClose()
              }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/15 px-4 py-3 text-sm font-semibold text-teal-100 transition-[color,background-color,border-color,transform] duration-150 hover:border-teal-400/55 hover:bg-teal-500/25 active:scale-[0.98]"
            >
              <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
              Log purpose & outcome
            </button>
          ) : null}
          {/* Primary: Missed/Busy/Hold → Call back; answered → Continue in CRM. */}
          {dialFirst ? (
            <CallBackButton
              phone={call.callerNumber}
              openIntakeDraft={needsRevenueRescue(call) || isHoldLog}
              intakeCall={call}
              missed={isMissedLog}
              hold={isHoldLog && !isMissedLog}
            />
          ) : canText || customerPhone ? (
            <Link
              href={`/dashboard/customers?phone=${encodeURIComponent(toE164(customerPhone) || customerPhone)}`}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-teal-500/50 bg-teal-500/20 px-4 py-3 text-sm font-semibold text-teal-50 transition-[color,background-color,border-color,transform] duration-150 hover:border-teal-400/70 hover:bg-teal-500/30 active:scale-[0.98]"
            >
              <UserRound className="h-4 w-4 shrink-0" aria-hidden />
              Continue in CRM
            </Link>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {dialFirst && canCompleteIntake ? (
              <button
                type="button"
                onClick={() => {
                  openIntakeForActivityCall(inbound, call)
                  onClose()
                }}
                className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-950/40 px-3 text-sm font-semibold text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-200"
              >
                <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
                Add note
              </button>
            ) : null}
            {dialFirst && (canText || customerPhone) ? (
              <Link
                href={`/dashboard/customers?phone=${encodeURIComponent(toE164(customerPhone) || customerPhone)}`}
                className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-950/40 px-3 text-sm font-semibold text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-200"
              >
                <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                Continue in CRM
              </Link>
            ) : null}
            {canText ? (
              <Link
                href={messagesHref}
                className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-950/40 px-3 text-sm font-semibold text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-200"
              >
                <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
                Text
              </Link>
            ) : null}
            {!dialFirst && showCallBack ? (
              <CallBackButton
                phone={call.callerNumber}
                openIntakeDraft={needsRevenueRescue(call)}
                intakeCall={call}
                missed={false}
                className="min-h-10 min-w-0 flex-1 !border-zinc-700/70 !bg-zinc-950/40 !text-zinc-400 hover:!border-zinc-600 hover:!bg-zinc-900/70 hover:!text-zinc-200"
              />
            ) : null}
            <SendBookLinkButton
              phone={call.callerNumber}
              callerName={call.callerName}
              businessLine={call.targetLineE164}
              callLogId={call.id}
              className="min-h-10 min-w-0 flex-1 !border-zinc-700/70 !bg-zinc-950/40 !text-zinc-400 hover:!border-zinc-600 hover:!bg-zinc-900/70 hover:!text-zinc-200"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-3 py-1 text-[11px] font-medium tabular-nums text-zinc-400">
              {formatDuration(call.durationSeconds)}
            </span>
            <CallTimeDisplay call={call} variant="compact" />
          </div>

          {canText ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    isMissedLog ? "text-rose-300" : "text-sky-300"
                  )}
                >
                  {isMissedLog ? "Missed-call text" : "Follow-up SMS"}
                </p>
                <Link
                  href={messagesHref}
                  className={cn(
                    "text-[11px] font-semibold underline-offset-2 hover:underline",
                    isMissedLog ? "text-rose-300/90" : "text-sky-300/90"
                  )}
                >
                  Messages
                </Link>
              </div>
              <CustomerSmsComposer
                toPhone={customerPhone}
                fromLine={call.targetLineE164 || null}
                organizationId={activeOrganizationId}
                variant={isMissedLog ? "missed" : "follow_up"}
                showRunningLate={!isMissedLog}
                showQuickTemplates
                showBookingLink
                title={isMissedLog ? "Recover this lead" : "Text customer"}
              />
            </div>
          ) : null}

          {/* Missed + no intake: skip the long Answered panel — summary covers it. */}
          {!isMissedLog || hasIntake ? (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                {isMissedLog ? "Intake & scheduling" : "Answered panel & scheduling"}
              </p>
              <div className="mt-3">
                <ActivityIntakeSummary
                  activity={activity}
                  callerPhone={call.callerNumber}
                  call={call}
                />
              </div>
              {schedulerHref ? (
                <Link
                  href={schedulerHref}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition-[color,background-color,border-color] duration-150 hover:border-teal-400/40 hover:bg-slate-800 hover:text-teal-300"
                >
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  {activity.scheduleAt ? "View on scheduler map" : "Schedule this job"}
                </Link>
              ) : null}
            </div>
          ) : null}

          <p className="px-0.5 text-xs leading-relaxed text-zinc-400">{summary}</p>

          {call.hasRecording && call.recordingUrl ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Call recording</p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls preload="none" src={call.recordingUrl} className="w-full">
                Your browser does not support audio playback.
              </audio>
            </div>
          ) : null}
        </div>
      </DrawerScrollBody>
      <DrawerStickyFooter dirty={false} saving={false} onSave={onClose} onCancel={onClose} saveLabel="Close" />
    </>
  )
}

type ActivityTableProps = {
  rows: GroupedActivityCall[]
  lineLabelMap: Map<string, string>
}

/** Caller name with optional day-group count: “Jeff Lanham · 3 calls”. */
function CallerNameWithCount({
  call,
  interactive = false,
  dense = false,
}: {
  call: GroupedActivityCall
  interactive?: boolean
  dense?: boolean
}) {
  const countLabel = formatGroupedCallCountLabel(call.count)
  return (
    <p
      className={cn(
        "truncate font-medium text-foreground transition-colors duration-150",
        dense ? "text-sm leading-tight" : "text-base",
        interactive && "group-hover/caller:text-teal-300"
      )}
      title={countLabel ? `${call.callerName} ${countLabel}` : call.callerName}
    >
      <span>{call.callerName}</span>
      {countLabel ? (
        <span className="ml-1.5 font-normal text-slate-400">{countLabel}</span>
      ) : null}
    </p>
  )
}

/** Shared next-step strip — Missed/Busy/Hold/Press 1: Call back loud; else CRM loud. */
function ActivityGroupActionBar({
  call,
  className,
}: {
  call: UiCallRecord
  className?: string
}) {
  // Classify from the representative (usually latest) leg for Call-back styling.
  const st = classifyCall(call)
  const missed = isMissedActivityStatus(st)
  const hold = isHoldActivityStatus(st) || st === "hold_press1"
  const rawPhone = call.callerNumber?.trim() || ""
  const hasPhone = Boolean(rawPhone && rawPhone !== "—")
  const phoneForLink = hasPhone ? toE164(rawPhone) || rawPhone : ""
  const canText =
    hasPhone && (Boolean(toE164(rawPhone)) || rawPhone.replace(/\D/g, "").length >= 10)
  const crmHref = hasPhone
    ? `/dashboard/customers?phone=${encodeURIComponent(phoneForLink)}`
    : null
  const messagesHref = canText
    ? `/dashboard/messages?phone=${encodeURIComponent(rawPhone)}`
    : null
  // Quiet secondary chips — same actions, less “four equal buttons.”
  const secondaryChip =
    "!h-8 min-w-0 flex-1 !border-zinc-700/70 !bg-zinc-950/40 !text-zinc-400 hover:!border-zinc-600 hover:!bg-zinc-900/70 hover:!text-zinc-200"
  const canDial = canCallBack(call)
  // Dial-first for Missed + Busy / Hold / Press 1; answered stay CRM-first.
  const callBackPrimary = (missed || hold) && canDial

  return (
    <div className={cn("space-y-2", className)}>
      {callBackPrimary ? (
        <CallBackButton
          phone={call.callerNumber}
          openIntakeDraft={needsRevenueRescue(call) || hold}
          intakeCall={call}
          missed={missed}
          hold={hold && !missed}
          className={cn(
            "h-10 w-full",
            missed ? "shadow-sm shadow-rose-950/30" : "shadow-sm shadow-amber-950/30"
          )}
        />
      ) : crmHref ? (
        <Link
          href={crmHref}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-teal-500/50 bg-teal-500/20 px-3 text-[13px] font-semibold text-teal-50 shadow-sm shadow-teal-950/30 hover:border-teal-400/70 hover:bg-teal-500/30"
          aria-label="Continue in CRM"
          title="Continue in CRM"
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Continue in CRM
        </Link>
      ) : null}
      {/* Secondary moves — quieter under the primary path. */}
      <div className="flex flex-wrap items-center gap-2">
        {callBackPrimary && crmHref ? (
          <Link
            href={crmHref}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-lg border px-3 text-[11px] font-semibold",
              secondaryChip
            )}
            aria-label="Continue in CRM"
            title="Continue in CRM"
          >
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Continue in CRM
          </Link>
        ) : null}
        {messagesHref ? (
          <Link
            href={messagesHref}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-lg border px-3 text-[11px] font-semibold",
              secondaryChip
            )}
            aria-label="Text in Messages"
            title="Text"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Text
          </Link>
        ) : null}
        {!callBackPrimary && canDial ? (
          <CallBackButton
            phone={call.callerNumber}
            compact
            className={secondaryChip}
            openIntakeDraft={needsRevenueRescue(call) || hold}
            intakeCall={call}
            missed={missed}
            hold={hold && !missed}
          />
        ) : null}
        <SendBookLinkButton
          phone={call.callerNumber}
          callerName={call.callerName}
          businessLine={call.targetLineE164}
          callLogId={call.id}
          compact
          className={cn(
            secondaryChip,
            "!min-h-0",
            !canDial && !messagesHref && !(callBackPrimary && crmHref) ? "w-full" : undefined
          )}
        />
      </div>
    </div>
  )
}

/**
 * One expanded leg.
 * Lean (multi-call group): status chip + time · duration only — tap opens details.
 * Full (single call): actions, intake, and detail CTA stay on the leg.
 */
function ActivityCallLegActions({
  call,
  lineLabelMap,
  onOpenDetails,
  showLine = false,
  lean = false,
  showIntake = true,
}: {
  call: UiCallRecord
  lineLabelMap: Map<string, string>
  onOpenDetails: (call: UiCallRecord) => void
  showLine?: boolean
  /** Compact chronology-only leg for multi-call groups. */
  lean?: boolean
  /** When false, skip intake / job card (shown once at group level). */
  showIntake?: boolean
}) {
  const st = classifyCall(call)
  const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)

  // Multi-call expand: one shared action/job row above — children are a timeline only.
  if (lean) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenDetails(call)
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/30 px-3 py-2 text-left transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-900/50"
        aria-label={`Open details for call at ${call.time || "unknown time"}`}
      >
        <ActivityStatusPill status={st} dense />
        <span className="min-w-0 flex-1 text-[11px] text-zinc-400">
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <CallTimeDisplay call={call} variant="inline" />
            <span className="text-zinc-600">·</span>
            <span className="tabular-nums">{formatDuration(call.durationSeconds)}</span>
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
      </button>
    )
  }

  const timeline = buildCallActionsTimeline(call)
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <ActivityStatusPill status={st} dense />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
            <CallTimeDisplay call={call} variant="inline" />
            <span className="text-zinc-600">·</span>
            <span className="tabular-nums">{formatDuration(call.durationSeconds)}</span>
          </p>
          {showLine ? (
            <p className="mt-0.5 truncate text-[10px] text-zinc-600" title={targetLabel}>
              {targetLabel}
            </p>
          ) : null}
        </div>
      </div>
      {timeline.length > 0 ? (
        <ul className="space-y-0.5 px-0.5">
          {timeline.slice(0, 2).map((line, i) => (
            <li key={`${call.id}-tl-${i}`} className="flex gap-2 text-[10px] text-zinc-500">
              <Clock className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ActivityGroupActionBar call={call} />
      {showIntake && call.activity ? (
        <ActivityIntakeSummary
          activity={call.activity}
          compact
          callerPhone={call.callerNumber}
          call={call}
        />
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenDetails(call)
        }}
        className="self-start text-[11px] font-semibold text-cyan-400 underline-offset-2 transition-colors duration-150 hover:text-teal-300 hover:underline"
      >
        {shouldOpenIntakeOnActivityClick(call) ? "Log purpose & outcome" : "View call details"}
      </button>
    </div>
  )
}

const ActivityCallsMobileList = memo(function ActivityCallsMobileList({
  rows,
  lineLabelMap,
}: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()
  const inbound = useInboundCallPanelOptional()
  // Rows stay collapsed by default so more numbers fit on screen.
  // Accordion: at most one row expanded at a time (stable groupKey survives polls).
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // 12s-poll full-array replace, not Pusher-pushed — "arrival" computed client-side.
  const rowKeys = useMemo(() => rows.map((call) => call.groupKey), [rows])
  const recentRowKeys = useRecentArrivals(rowKeys)

  function toggleExpanded(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  function openLogSheet(call: UiCallRecord) {
    setSelectedActivityLog(call)
    openLog(call)
  }

  function openDetails(call: UiCallRecord) {
    openActivityCallFromList(call, inbound, openLogSheet)
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm font-medium text-zinc-300">No calls yet</p>
        <p className="max-w-xs text-xs text-zinc-500">
          When someone dials your business line, the call shows up here so you can continue in CRM.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-teal-500/45 bg-teal-500/15 px-4 text-xs font-semibold text-teal-100 hover:bg-teal-500/25"
        >
          Open Lines
        </Link>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-zinc-800/70">
      {rows.map((call) => {
        const st = classifyCall(call)
        const expanded = expandedKey === call.groupKey
        const missed = isMissedActivityStatus(st)
        const multi = call.count > 1
        // One shared job card for the day-group (avoid pasting Lockout · vehicle on every leg).
        const jobCall = multi ? pickGroupJobActivityCall(call.members) : null
        const intakeShort =
          call.activity?.intakeAction === "No intake recorded"
            ? "No intake"
            : call.activity?.intakeAction || null
        // Don't show “Pending time” on hold/missed rows when it came from another lead on this phone.
        const showIntakeShort =
          !expanded &&
          intakeShort &&
          intakeShort !== "No intake" &&
          !(intakeShort === "Pending time" && (isMissedActivityStatus(st) || isHoldActivityStatus(st)))
        return (
          <li
            key={call.groupKey}
            className={cn(
              "px-3 py-2 transition-colors transition-shadow duration-150",
              activityRowAccentClass(st),
              expanded && "bg-zinc-950/40",
              // New-arrival pulse — self-clears when useRecentArrivals expires the key.
              recentRowKeys.has(call.groupKey) && "ring-2 ring-sky-400/70 duration-700"
            )}
          >
            {/*
              Collapsed: status · name (+ N calls) · full phone · latest time/duration/intake · chevron.
              Expanded: compact header only — chronology + actions live below (no duplicate summary).
            */}
            <button
              type="button"
              onClick={() => toggleExpanded(call.groupKey)}
              className="group/caller flex w-full min-w-0 items-start gap-2 rounded-lg py-0.5 text-left"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Collapse ${call.callerName}`
                  : `Expand ${call.callerName} for call times and actions`
              }
            >
              <ActivityStatusPill status={st} dense />
              <span className="min-w-0 flex-1">
                {/* Name can ellipsis; phone must never truncate. */}
                <CallerNameWithCount call={call} interactive dense />
                <p
                  className={cn(
                    "mt-0.5 whitespace-nowrap text-[11px] font-medium",
                    missed
                      ? "text-rose-300/90"
                      : isHoldActivityStatus(st)
                        ? "text-amber-300/90"
                        : "text-cyan-400/90"
                  )}
                >
                  {call.callerNumber}
                </p>
                {/* Collapsed only: latest duration · time · intake (N calls already on the name). */}
                {!expanded ? (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    <CallTimeDisplay call={call} variant="inline" />
                    <span className="shrink-0 text-zinc-600">·</span>
                    <span className="shrink-0 tabular-nums">
                      {formatDuration(call.durationSeconds)}
                    </span>
                    {showIntakeShort ? (
                      <>
                        <span className="shrink-0 text-zinc-600">·</span>
                        <span className="min-w-0 truncate text-zinc-500">{intakeShort}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </span>
              <ChevronDown
                className={cn(
                  "mt-1 h-4 w-4 shrink-0 text-zinc-600 transition-transform duration-150 group-hover/caller:text-teal-400",
                  expanded && "rotate-180 text-teal-400"
                )}
                aria-hidden
              />
            </button>

            {/* Expanded: group actions + one job card, then lean per-call chronology. */}
            {expanded ? (
              <div className="mt-2 space-y-2 border-t border-zinc-800/80 pt-2">
                {multi ? (
                  <>
                    <ActivityGroupActionBar call={call} />
                    {jobCall?.activity ? (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
                        <ActivityIntakeSummary
                          activity={jobCall.activity}
                          compact
                          callerPhone={jobCall.callerNumber}
                          call={jobCall}
                        />
                      </div>
                    ) : null}
                    <p className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                      Calls today · tap a row for details
                    </p>
                  </>
                ) : null}
                <div className={cn(multi ? "space-y-1" : "space-y-2")}>
                  {call.members.map((leg) => (
                    <ActivityCallLegActions
                      key={leg.id}
                      call={leg}
                      lineLabelMap={lineLabelMap}
                      onOpenDetails={openDetails}
                      showLine={!multi}
                      lean={multi}
                      showIntake={!multi}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
})

const ActivityCallsTable = memo(function ActivityCallsTable({ rows, lineLabelMap }: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()
  const inbound = useInboundCallPanelOptional()
  // Stable groupKey so expand state survives poll refreshes.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set())
  // 12s-poll full-array replace, not Pusher-pushed — "arrival" computed client-side.
  const rowKeys = useMemo(() => rows.map((call) => call.groupKey), [rows])
  const recentRowKeys = useRecentArrivals(rowKeys)

  function openLogSheet(call: UiCallRecord) {
    setSelectedActivityLog(call)
    openLog(call)
  }

  function openDetails(call: UiCallRecord) {
    openActivityCallFromList(call, inbound, openLogSheet)
  }

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    // Same surface as the page — bg-card/90 + shadow looked like a dim reddish overlay after load.
    <WorkspacePanel className="bg-background shadow-none ring-0">
      {/* Cards through tablet: the 8-column table needs ~1024px — below that, cells
          overflow and the status badge/caller name paint over the next column. */}
      <div className="lg:hidden">
        <ActivityCallsMobileList rows={rows} lineLabelMap={lineLabelMap} />
      </div>
      <div className="hidden lg:block">
        <WorkspaceTableWrap className="min-h-0" bleed>
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[12%]" />
          <col className="w-[18%]" />
          <col className="w-[16%]" />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr>
            <WorkspaceTh>Status</WorkspaceTh>
            <WorkspaceTh>Called</WorkspaceTh>
            <WorkspaceTh>Caller</WorkspaceTh>
            <WorkspaceTh>Intake</WorkspaceTh>
            <WorkspaceTh>Duration</WorkspaceTh>
            <WorkspaceTh>Agent</WorkspaceTh>
            <WorkspaceTh>Line</WorkspaceTh>
            <WorkspaceTh>
              <span className="sr-only">Actions</span>
            </WorkspaceTh>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <WorkspaceTd colSpan={8} className="!px-3 py-12">
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm font-medium text-zinc-300">No calls yet</p>
                  <p className="max-w-sm text-xs text-zinc-500">
                    When someone dials your business line, the call shows up here so you can continue
                    in CRM.
                  </p>
                  <Link
                    href="/dashboard"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-teal-500/45 bg-teal-500/15 px-4 text-xs font-semibold text-teal-100 hover:bg-teal-500/25"
                  >
                    Open Lines
                  </Link>
                </div>
              </WorkspaceTd>
            </tr>
          ) : (
            rows.map((call) => {
              const st = classifyCall(call)
              const missed = isMissedActivityStatus(st)
              const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)
              // Always allow expand so single legs still open actions/details consistently.
              const expanded = expandedKeys.has(call.groupKey)
              const multi = call.count > 1
              return (
                <Fragment key={call.groupKey}>
                  <tr
                    className={cn(
                      WORKSPACE_TABLE_ROW_CLASS,
                      "group/row transition-colors duration-700 hover:bg-slate-800/55",
                      activityRowAccentClass(st),
                      // New-arrival pulse — box-shadow rings clip oddly on <tr>, use bg instead.
                      recentRowKeys.has(call.groupKey) && "!bg-sky-500/20"
                    )}
                  >
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      <ActivityStatusPill status={st} />
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      <div className="flex items-center gap-1">
                        <CallTimeDisplay call={call} />
                        <button
                          type="button"
                          onClick={() => toggleExpanded(call.groupKey)}
                          className="rounded p-0.5 text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-teal-300"
                          aria-label={expanded ? "Hide call details" : "Show call details"}
                          aria-expanded={expanded}
                        >
                          <ChevronDown
                            className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-180")}
                            aria-hidden
                          />
                        </button>
                      </div>
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(call.groupKey)}
                        className="group/caller w-full min-w-0 cursor-pointer rounded-md text-left transition-colors duration-150 hover:bg-slate-800/40"
                      >
                        <CallerNameWithCount call={call} interactive />
                      </button>
                      {canCallBack(call) ? (
                        <a
                          href={buildTelHref(call.callerNumber) ?? undefined}
                          className={cn(
                            "block truncate text-xs font-medium underline-offset-2 transition-colors duration-150 hover:underline",
                            missed
                              ? "text-rose-300 hover:text-rose-200"
                              : "text-cyan-400 hover:text-teal-300"
                          )}
                          title={call.callerNumber}
                        >
                          {call.callerNumber}
                        </a>
                      ) : (
                        <p className="truncate text-xs text-zinc-500" title={call.callerNumber}>
                          {call.callerNumber}
                        </p>
                      )}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      {call.activity ? (
                        <ActivityIntakeSummary
                          activity={call.activity}
                          compact
                          callerPhone={call.callerNumber}
                          call={call}
                        />
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle tabular-nums text-sm text-zinc-300">
                      {formatDuration(call.durationSeconds)}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      {multi ? (
                        <span
                          className="line-clamp-2 text-[11px] leading-snug text-slate-500"
                          title={formatGroupedCallSummary(call)}
                        >
                          {formatGroupedCallSummary(call)}
                        </span>
                      ) : (
                        <AgentBadge agent={resolveCallAgent(call)} compact />
                      )}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle">
                      <p className="truncate text-sm font-medium text-zinc-200" title={targetLabel}>
                        {targetLabel}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={call.routedTo}>
                        {formatRoutedToLabel(call.routedTo)}
                      </p>
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-3 align-middle text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        {canCallBack(call) ? (
                          <CallBackButton
                            phone={call.callerNumber}
                            compact
                            openIntakeDraft={needsRevenueRescue(call)}
                            intakeCall={call}
                            missed={missed}
                          />
                        ) : null}
                        <SendBookLinkButton
                          phone={call.callerNumber}
                          callerName={call.callerName}
                          businessLine={call.targetLineE164}
                          callLogId={call.id}
                          compact
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          onClick={() => openDetails(call)}
                          className="inline-flex h-8 items-center rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-3 text-[11px] font-semibold text-zinc-300 transition-[color,background-color,border-color] duration-150 hover:border-teal-400/40 hover:bg-slate-800 hover:text-teal-300"
                        >
                          {shouldOpenIntakeOnActivityClick(call) ? "Intake" : "Log"}
                        </button>
                      </div>
                    </WorkspaceTd>
                  </tr>
                  {expanded ? (
                    <tr className="bg-zinc-950/50">
                      <WorkspaceTd colSpan={8} className="!px-3 !py-3">
                        <div className="space-y-2">
                          {multi ? (
                            <>
                              <ActivityGroupActionBar call={call} className="max-w-xl" />
                              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                                Calls today · tap a row for details
                              </p>
                            </>
                          ) : null}
                          <div
                            className={cn(
                              multi
                                ? "grid gap-1 sm:grid-cols-2 xl:grid-cols-3"
                                : "grid gap-2 md:grid-cols-2 xl:grid-cols-3"
                            )}
                          >
                            {call.members.map((leg) => (
                              <ActivityCallLegActions
                                key={leg.id}
                                call={leg}
                                lineLabelMap={lineLabelMap}
                                onOpenDetails={openDetails}
                                lean={multi}
                                // Parent row already shows intake + Call/CRM once for multi groups.
                                showIntake={!multi}
                              />
                            ))}
                          </div>
                        </div>
                      </WorkspaceTd>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })
          )}
        </tbody>
      </WorkspaceTableWrap>
      </div>
    </WorkspacePanel>
  )
})

type ActivityBodyProps = {
  calls: UiCallRecord[]
  loading: boolean
  /** Tiny cookie stub — keep skeleton until full list arrives (no short wrong-list flash). */
  paintOnly?: boolean
  loadError: string | null
  lineLabelMap: Map<string, string>
  filter: ActivityCallFilter
  onFilterChange: (next: ActivityCallFilter) => void
}

const ActivityWorkspaceBody = memo(function ActivityWorkspaceBody({
  calls,
  loading,
  paintOnly = false,
  loadError,
  lineLabelMap,
  filter,
  onFilterChange,
}: ActivityBodyProps) {
  const { activeLine, businessNumbersLoading } = useDashboardWorkspace()
  const shopLines = useWorkspacePhoneLines()
  const waitingForLines = businessNumbersLoading && shopLines.length === 0 && !activeLine

  // Every DID on this shop — not only the painted Main Line (Amber hid Key Squad history).
  const scopedCalls = useMemo(
    () =>
      scopeCallsToShopLines(calls, shopLines, {
        activeLine,
        linesLoading: businessNumbersLoading,
      }),
    [calls, shopLines, activeLine, businessNumbersLoading]
  )

  const missedCount = useMemo(
    () => scopedCalls.filter((c) => isMissedActivityCallToday(c)).length,
    [scopedCalls]
  )
  const holdCount = useMemo(
    () => scopedCalls.filter((c) => isHoldFilterCall(c)).length,
    [scopedCalls]
  )
  const press1Count = useMemo(
    () => scopedCalls.filter((c) => isPress1FilterCall(c)).length,
    [scopedCalls]
  )

  const rows = useMemo(() => {
    const sorted = [...scopedCalls].sort((a, b) => {
      const aTs = a.createdAt || `${a.date} ${a.time}`
      const bTs = b.createdAt || `${b.date} ${b.time}`
      return bTs.localeCompare(aTs)
    })
    // One row per caller phone per calendar day (browser TZ, else Eastern).
    const grouped = groupCallsByPhoneAndDay(sorted, {
      timeZone: resolveBrowserTimezone(),
    })
    // Filters keep a day-group if any child matches; collapsed status uses latest match.
    if (filter === "missed") {
      return filterActivityCallGroups(grouped, (c) => isMissedActivityCallToday(c))
    }
    if (filter === "hold") {
      return filterActivityCallGroups(grouped, (c) => isHoldFilterCall(c))
    }
    if (filter === "press1") {
      return filterActivityCallGroups(grouped, (c) => isPress1FilterCall(c))
    }
    return grouped
  }, [scopedCalls, filter])

  // If scoping briefly hides rows but we already have calls, keep showing them (no empty flash).
  const displayRows = useMemo(() => {
    if (rows.length > 0) return rows
    if (calls.length === 0) return rows
    const sorted = [...calls].sort((a, b) => {
      const aTs = a.createdAt || `${a.date} ${a.time}`
      const bTs = b.createdAt || `${b.date} ${b.time}`
      return bTs.localeCompare(aTs)
    })
    const grouped = groupCallsByPhoneAndDay(sorted, {
      timeZone: resolveBrowserTimezone(),
    })
    if (filter === "missed") {
      return filterActivityCallGroups(grouped, (c) => isMissedActivityCallToday(c))
    }
    if (filter === "hold") {
      return filterActivityCallGroups(grouped, (c) => isHoldFilterCall(c))
    }
    if (filter === "press1") {
      return filterActivityCallGroups(grouped, (c) => isPress1FilterCall(c))
    }
    return grouped
  }, [rows, calls, filter])

  // Quiet empty well while waiting — never grey skeleton pills, never short cookie stub.
  const showingQuietLoad = loading && calls.length === 0
  const showMissedEmpty =
    filter === "missed" && displayRows.length === 0 && !loading && !waitingForLines
  const showHoldEmpty =
    filter === "hold" && displayRows.length === 0 && !loading && !waitingForLines
  const showPress1Empty =
    filter === "press1" && displayRows.length === 0 && !loading && !waitingForLines
  // Filter-specific empty replaces the generic “No calls yet” table empty (was a double flash).
  const showFilterEmpty = showMissedEmpty || showHoldEmpty || showPress1Empty

  useFlickerDebugLifecycle("ActivityWorkspaceBody", {
    loading,
    waitingForLines,
    showingQuietLoad,
    paintOnly,
    callCount: calls.length,
    scopedCallCount: scopedCalls.length,
    displayRowCount: displayRows.length,
    shopLineCount: shopLines.length,
    hasActiveLine: Boolean(activeLine),
    businessNumbersLoading,
    filter,
  })

  return (
    <WorkspacePage>
      <WorkspacePageHeader
        eyebrow="Call history"
        title={
          filter === "missed"
            ? "Missed calls today"
            : filter === "hold"
              ? "Hold queue"
              : filter === "press1"
                ? "Press 1 bookings"
                : "Activities"
        }
      />
      {/* Desktop-only shortcuts — kept out of the header so mobile never gets a status row under the title. */}
      <div className="hidden flex-wrap items-center gap-3 sm:flex">
        <Link
          href="/dashboard/contacts"
          className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition-[color,background-color,border-color] duration-150 hover:border-sky-400/50 hover:bg-slate-800 hover:text-sky-200"
        >
          Dispatch Map
        </Link>
        <Link
          href="/dashboard/scheduler"
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-[color,background-color,border-color] duration-150 hover:border-teal-400/50 hover:bg-slate-800 hover:text-teal-300"
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Job scheduler
        </Link>
      </div>

      {/* Call activity only — assign / pins live on Map + Scheduler. */}
      <ActivityCallFilterBar
        filter={filter}
        missedCount={missedCount}
        holdCount={holdCount}
        press1Count={press1Count}
        onChange={onFilterChange}
      />
      {showingQuietLoad ? (
        <div
          className="min-h-[16rem] rounded-2xl border border-zinc-800/60 bg-background"
          aria-busy="true"
          aria-label="Loading activity"
        />
      ) : loadError && calls.length === 0 ? (
        <p className="min-h-[12rem] text-sm text-destructive">{loadError}</p>
      ) : showFilterEmpty ? (
        <div key={filter} className="lyncr-content-swap">
          {showMissedEmpty ? (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-10 text-center">
              <PhoneMissed className="mx-auto mb-2 h-8 w-8 text-amber-400/80" aria-hidden />
              <p className="text-sm font-medium text-zinc-200">No missed calls today</p>
              <p className="mt-1 text-xs text-zinc-500">
                This list resets at midnight. Yesterday’s missed calls stay in All calls.
              </p>
            </div>
          ) : null}
          {showHoldEmpty ? (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-200">No hold-queue calls</p>
              <p className="mt-1 text-xs text-zinc-500">
                Callers who waited on hold show up here.
              </p>
            </div>
          ) : null}
          {showPress1Empty ? (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-200">No Press 1 bookings yet</p>
              <p className="mt-1 text-xs text-zinc-500">
                When a caller presses 1 for a booking text, it shows up here.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div key={filter} className="lyncr-content-swap">
          <ActivityCallsTable rows={displayRows} lineLabelMap={lineLabelMap} />
        </div>
      )}
    </WorkspacePage>
  )
})

function useLineLabelMap(): Map<string, string> {
  const shopLines = useWorkspacePhoneLines()

  return useMemo(() => {
    if (shopLines.length === 0) return new Map<string, string>()
    const entries: LineLabelEntry[] = shopLines.map((n) => ({
      number: n.number,
      label: n.label ?? "Business Line",
    }))
    return buildBusinessLineLabelMap(entries)
  }, [shopLines])
}

const ActivityWorkspaceViewInner = memo(function ActivityWorkspaceViewInner({
  // Presence host keeps this pane mounted — only poll while the tab is visible.
  isActive = true,
  urlQuery,
  initialCalls = null,
}: {
  isActive?: boolean
  // Live URL query from ClientSearchParamsBridge (does not suspend this pane).
  urlQuery: string
  /** Hard-refresh SSR rows — first HTML is the real table. */
  initialCalls?: UiCallRecord[] | null
}) {
  // Pause Activity polls when the pane or browser tab is hidden.
  const pollEnabled = usePollBudget(isActive)
  const { calls, loading, loadError, paintOnly } = useOperationsData({
    refetchIntervalMs: 12_000,
    enabled: pollEnabled,
    initialCalls,
  })
  const { setActivityLogs, closeActivityLog } = useDashboardWorkspace()
  const lineLabelMap = useLineLabelMap()
  // Parse ?filter= without useSearchParams() so tab clicks cannot remount this tree.
  const searchParams = useMemo(() => searchQueryToParams(urlQuery), [urlQuery])
  const router = useRouter()
  const [filter, setFilter] = useState<ActivityCallFilter>(() => {
    const param = searchParams.get("filter")
    if (param === "missed" || param === "missed_leads") return "missed"
    if (param === "hold") return "hold"
    if (param === "press1") return "press1"
    return "all"
  })
  useBookingAlerts(pollEnabled)

  useFlickerDebugLifecycle("ActivityWorkspaceView", {
    isActive,
    pollEnabled,
    loading,
    callCount: calls.length,
    filter,
  })

  useEffect(() => {
    const param = searchParams.get("filter")
    if (param === "missed" || param === "missed_leads") setFilter("missed")
    else if (param === "hold") setFilter("hold")
    else if (param === "press1") setFilter("press1")
    else if (param === "all") setFilter("all")
  }, [searchParams])

  const handleFilterChange = useCallback(
    (next: ActivityCallFilter) => {
      setFilter(next)
      const params = new URLSearchParams(searchParams.toString())
      params.set("filter", next)
      router.replace(`/dashboard/activity?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  useEffect(() => {
    // Keep repeat-caller urgency in sync without rewriting context on every identical poll.
    setActivityLogs(calls)
  }, [calls, setActivityLogs])

  // Cookie stub stays hidden (skeleton) until session/network delivers the full list.
  return (
    <WorkspaceRightSheetGate<UiCallRecord>
      sheetTitle="Call details"
      render={(call, close) => (
        <CallLogSheet
          call={call}
          onClose={() => {
            close()
            closeActivityLog()
          }}
        />
      )}
    >
      <ActivityWorkspaceBody
        calls={calls}
        loading={loading}
        paintOnly={paintOnly}
        loadError={loadError}
        lineLabelMap={lineLabelMap}
        filter={filter}
        onFilterChange={handleFilterChange}
      />
    </WorkspaceRightSheetGate>
  )
})

/** Outer wrapper: URL bridge is isolated — Inner stays mounted across tab clicks. */
export const ActivityWorkspaceView = memo(function ActivityWorkspaceView({
  isActive = true,
  initialCalls = null,
}: {
  isActive?: boolean
  /** Hard-refresh SSR rows from `app/dashboard/activity/page.tsx`. */
  initialCalls?: UiCallRecord[] | null
}) {
  // Seed from window so the first client paint has ?filter= before the bridge hydrates.
  const [urlQuery, setUrlQuery] = useState(readWindowSearchQuery)
  const onQuery = useCallback((q: string) => setUrlQuery(q), [])
  return (
    <>
      <ClientSearchParamsBridge onQuery={onQuery} />
      <ActivityWorkspaceViewInner
        isActive={isActive}
        urlQuery={urlQuery}
        initialCalls={initialCalls}
      />
    </>
  )
})
