"use client"

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarDays, ChevronDown, ClipboardList, Clock, MapPin, Phone, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTelHref, toE164 } from "@/lib/phone-e164"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { isMissedCallRecord, isMissedCallTodayRecord, isIvrMenuHandler, type MissedCallRecordInput } from "@/lib/missed-call-telemetry"
import {
  CAPTURE_STATUS_BUSY_LINK,
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_FULL_DAY_LINK,
  CAPTURE_STATUS_NIGHT_LINK,
} from "@/lib/inbound-time-capture"
import { useIsMobile } from "@/hooks/use-mobile"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import type { CallActivityContext } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
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
  WORKSPACE_TABLE_ROW_CLASS,
  type ActivityCallStatus,
} from "@/components/dashboard-workspace-ui"
import {
  ActivityTableSkeleton,
} from "@/components/workspace-content-skeletons"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"
import { DispatchJobsPanel } from "@/components/workspace-views/dispatch-jobs-panel"
import dynamic from "next/dynamic"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { shouldPlayOperatorDispositionAlert } from "@/lib/admin-notification-client"
import { useOperationsData, type UiCallRecord } from "@/lib/hooks/use-operations-data"
import {
  formatCallChronologyLine,
  formatGroupedCallSummary,
  groupConsecutiveCallsByPhone,
  type GroupedActivityCall,
} from "@/lib/activity-call-groups"
import {
  buildBusinessLineLabelMap,
  resolveBusinessLineLabel,
  type LineLabelEntry,
} from "@/lib/line-display"

/** Leaflet map — only loaded when Activity tab mounts. */
const DispatchLiveMap = dynamic(
  () =>
    import("@/components/workspace-views/dispatch-live-map").then((m) => ({
      default: m.DispatchLiveMap,
    })),
  { ssr: false }
)

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
function useBookingAlerts() {
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
      const prefs = (e as CustomEvent<{ preferences?: typeof session.adminNotificationPreferences }>).detail
        ?.preferences
      if (!prefs) return
      setNoisyAlerts(prefs.push_operator_dispositions !== false)
    }
    window.addEventListener("zing-admin-notification-preferences-changed", onPrefs)
    return () => window.removeEventListener("zing-admin-notification-preferences-changed", onPrefs)
  }, [session])

  useEffect(() => {
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
  }, [toast, noisyAlerts])
}

/** Split call time into a scannable day label + clock time. */
function formatCallTimestampParts(call: UiCallRecord): { day: string; time: string; full: string } | null {
  if (call.createdAt) {
    const d = new Date(call.createdAt)
    if (!Number.isNaN(d.getTime())) {
      const now = new Date()
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const diffDays = Math.floor((startToday - startThatDay) / 86_400_000)
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      let day: string
      if (diffDays === 0) day = "Today"
      else if (diffDays === 1) day = "Yesterday"
      else day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      return { day, time, full: `${day}, ${time}` }
    }
  }
  if (call.date && call.time) {
    return { day: call.date, time: call.time, full: `${call.date}, ${call.time}` }
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
  variant?: "compact" | "prominent"
}) {
  const parts = formatCallTimestampParts(call)
  if (!parts) {
    return <span className="text-xs text-zinc-600">—</span>
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
  if (routed === CAPTURE_STATUS_NIGHT_LINK) return "night_link"
  if (routed === CAPTURE_STATUS_DAY_LINK) return "day_link"
  if (routed === CAPTURE_STATUS_FULL_DAY_LINK) return "day_off_link"
  if (routed === CAPTURE_STATUS_BUSY_LINK) return "busy_link"
  if (call.type === "voicemail" || /voicemail/i.test(routed)) return "voicemail"
  // IVR / keypad — amber Missed (IVR), never green Answered.
  if (isIvrMenuHandler(routed)) return "missed_ivr"
  if (/ai receptionist|voice ai|assistant/i.test(routed)) return "ai_handled"
  // Your Phone / human answer — green Answered even for short pickups (e.g. 6s).
  if (
    !isMissedCallRecord(missedRecordFromUiCall(call)) &&
    (Boolean(call.answeredAt) || (call.durationSeconds > 0 && Boolean(routed) && !isIvrMenuHandler(routed)))
  ) {
    return "answered"
  }
  if (isMissedCallRecord(missedRecordFromUiCall(call))) {
    return isIvrMenuHandler(routed) ? "missed_ivr" : "missed"
  }
  if (call.type === "missed") return "missed"
  return "missed"
}

type ActivityCallFilter = "all" | "missed"

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

/** Open global intake sheet with this caller prefilled (no dial). */
function openIntakeDraftForPhone(
  inbound: ReturnType<typeof useInboundCallPanelOptional>,
  phone: string
) {
  if (!inbound) return
  const trimmed = phone.trim()
  if (!trimmed || trimmed === "—") return
  inbound.openManualCallPanel({
    phoneNumber: toE164(trimmed),
    callStatus: "answered",
  })
}

function CallBackButton({
  phone,
  className,
  compact = false,
  /** When true: dial native tel: and open intake draft in parallel (missed / no intake). */
  openIntakeDraft = false,
}: {
  phone: string
  className?: string
  compact?: boolean
  openIntakeDraft?: boolean
}) {
  const inbound = useInboundCallPanelOptional()
  const href = buildTelHref(phone)
  if (!href) return null

  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Parallel: open intake draft sheet + fire native dialer.
    if (openIntakeDraft) {
      openIntakeDraftForPhone(inbound, phone)
    }
    window.location.href = href
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 font-semibold text-cyan-200 transition hover:bg-cyan-500/15 active:scale-[0.98]",
        compact ? "h-8 px-2.5 text-[11px]" : "min-h-11 w-full px-4 py-2.5 text-sm",
        className
      )}
    >
      <Phone className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      {compact ? "Call" : "Call back"}
    </a>
  )
}

function ActivityCallFilterBar({
  filter,
  missedCount,
  onChange,
}: {
  filter: ActivityCallFilter
  missedCount: number
  onChange: (next: ActivityCallFilter) => void
}) {
  const chips: { id: ActivityCallFilter; label: string; badge?: number }[] = [
    { id: "all", label: "All activity" },
    { id: "missed", label: "Missed today", badge: missedCount },
  ]

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Call list filter"
    >
      {chips.map((chip) => {
        const active = filter === chip.id
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.id)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition touch-manipulation",
              active
                ? chip.id === "missed"
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-100"
                  : "border-primary/40 bg-primary/15 text-primary"
                : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200"
            )}
          >
            {chip.id === "missed" ? <PhoneMissed className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            {chip.label}
            {chip.badge != null && chip.badge > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  active ? "bg-amber-500/25 text-amber-50" : "bg-amber-500/15 text-amber-300"
                )}
              >
                {chip.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

type CallAgent = { label: string; kind: "operator" | "ai" | "owner" | "none" }

/** Resolve who handled the call traffic for the Agent badge. */
function resolveCallAgent(call: UiCallRecord): CallAgent {
  const st = classifyCall(call)
  const routed = (call.routedTo ?? "").trim()
  if (st === "voicemail") return { label: "Voicemail", kind: "none" }
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
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-800/40 px-2 py-0.5 text-[11px] font-medium text-zinc-500"
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
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
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
  const agent = resolveCallAgent(call)
  const dur = formatDuration(call.durationSeconds)
  const caller = `${call.callerName} (${call.callerNumber})`
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
}: {
  activity: CallActivityContext
  compact?: boolean
  callerPhone?: string
}) {
  const inbound = useInboundCallPanelOptional()
  const schedulerHref = activity.leadId
    ? buildSchedulerFocusUrl(activity.leadId, { schedule: !activity.scheduleAt })
    : null
  const isNoIntake = activity.intakeAction === "No intake recorded"
  const canOpenIntakeDraft = Boolean(isNoIntake && callerPhone && inbound)

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
            openIntakeDraftForPhone(inbound, callerPhone!)
          }}
          className={cn(
            "inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[10px] font-medium",
            compact ? "normal-case tracking-normal" : "uppercase tracking-wide font-semibold rounded-full",
            intakeActionTone(activity.intakeAction),
            "cursor-pointer transition-colors hover:brightness-110"
          )}
          aria-label="Open intake draft for this caller"
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
            "inline-flex items-center gap-1 font-medium text-cyan-400 hover:text-cyan-300",
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
  const agent = resolveCallAgent(call)
  const summary = buildCallSummary(call)
  const showCallBack = canCallBack(call)
  const activity = call.activity ?? {
    intakeAction: "No intake recorded",
    intakeDetail: null,
    scheduleLabel: null,
    scheduleAt: null,
    leadId: null,
    callerScheduleHint: null,
    callerPoolCount: 0,
  }
  const schedulerHref = activity.leadId
    ? buildSchedulerFocusUrl(activity.leadId, { schedule: !activity.scheduleAt })
    : null

  return (
    <>
      <DrawerStepHeader
        step="Log"
        title="Call detail"
        subtitle={`${call.callerName} · ${call.callerNumber}`}
      />
      <DrawerScrollBody>
        <div className="space-y-4">
          {showCallBack ? (
            <CallBackButton
              phone={call.callerNumber}
              openIntakeDraft={needsRevenueRescue(call)}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-400">
              {formatDuration(call.durationSeconds)}
            </span>
            <CallTimeDisplay call={call} variant="compact" />
          </div>

          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              Answered panel &amp; scheduling
            </p>
            <div className="mt-3">
              <ActivityIntakeSummary activity={activity} callerPhone={call.callerNumber} />
            </div>
            {schedulerHref ? (
              <Link
                href={schedulerHref}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
                {activity.scheduleAt ? "View on scheduler map" : "Schedule this job"}
              </Link>
            ) : null}
          </div>

          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />
              Call summary
            </p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-200">{summary}</p>
          </div>

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

/** Caller name with optional collapsed-count suffix: Unknown Caller (2). */
function CallerNameWithCount({ call }: { call: GroupedActivityCall }) {
  return (
    <p className="truncate font-medium text-foreground" title={call.callerName}>
      <span>{call.callerName}</span>
      {call.count > 1 ? (
        <span className="ml-1.5 font-normal text-slate-400">({call.count})</span>
      ) : null}
    </p>
  )
}

/** Nested timestamps for a collapsed same-number group (newest first). */
function GroupedCallChronology({ members }: { members: UiCallRecord[] }) {
  if (members.length <= 1) return null
  return (
    <ul className="mt-2 space-y-1 border-l border-slate-800 pl-3">
      {members.map((m) => (
        <li key={m.id} className="text-[11px] leading-snug text-slate-400">
          • {formatCallChronologyLine(m)}
        </li>
      ))}
    </ul>
  )
}

const ActivityCallsMobileList = memo(function ActivityCallsMobileList({
  rows,
  lineLabelMap,
}: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-zinc-600">No calls yet</p>
    )
  }

  return (
    <ul className="divide-y divide-zinc-800/80">
      {rows.map((call) => {
        const st = classifyCall(call)
        const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)
        const expandable = call.count > 1
        const expanded = expandable && expandedIds.has(call.id)
        return (
          <li key={call.id} className="px-4 py-3.5">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  if (expandable) {
                    toggleExpanded(call.id)
                    return
                  }
                  setSelectedActivityLog(call)
                  openLog(call)
                }}
                className="flex w-full flex-col gap-2 text-left transition-colors"
                aria-expanded={expandable ? expanded : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <ActivityStatusPill status={st} />
                  <div className="flex shrink-0 items-start gap-1.5">
                    <CallTimeDisplay call={call} variant="prominent" />
                    {expandable ? (
                      <ChevronDown
                        className={cn(
                          "mt-0.5 h-4 w-4 text-slate-500 transition-transform",
                          expanded && "rotate-180"
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <CallerNameWithCount call={call} />
                  {canCallBack(call) ? (
                    <a
                      href={buildTelHref(call.callerNumber) ?? undefined}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate text-xs font-medium text-cyan-400 underline-offset-2 hover:underline"
                    >
                      {call.callerNumber}
                    </a>
                  ) : (
                    <p className="truncate text-xs text-zinc-500">{call.callerNumber}</p>
                  )}
                </div>
                {expanded ? <GroupedCallChronology members={call.members} /> : null}
              </button>
              {canCallBack(call) ? (
                <CallBackButton
                  phone={call.callerNumber}
                  compact
                  className="w-full"
                  openIntakeDraft={needsRevenueRescue(call)}
                />
              ) : null}
              {call.activity ? (
                <ActivityIntakeSummary
                  activity={call.activity}
                  compact
                  callerPhone={call.callerNumber}
                />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {call.count > 1 ? (
                    <span className="truncate text-[11px] text-slate-500">
                      {formatGroupedCallSummary(call)}
                    </span>
                  ) : (
                    <AgentBadge agent={resolveCallAgent(call)} compact />
                  )}
                  <span className="truncate" title={targetLabel}>
                    {targetLabel}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-zinc-400">
                  {formatDuration(call.durationSeconds)}
                </span>
              </div>
              {expandable ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedActivityLog(call)
                    openLog(call)
                  }}
                  className="self-start text-[11px] font-semibold text-cyan-400 underline-offset-2 hover:underline"
                >
                  View latest log
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
})

const ActivityCallsTable = memo(function ActivityCallsTable({ rows, lineLabelMap }: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <WorkspacePanel className="min-h-[380px]">
      <div className="md:hidden">
        <ActivityCallsMobileList rows={rows} lineLabelMap={lineLabelMap} />
      </div>
      <div className="hidden md:block">
      <WorkspaceTableWrap className="min-h-[340px]" bleed>
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
            <WorkspaceTh />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <WorkspaceTd colSpan={8} className="py-12 text-center text-zinc-600">
                No calls yet
              </WorkspaceTd>
            </tr>
          ) : (
            rows.map((call) => {
              const st = classifyCall(call)
              const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)
              const expandable = call.count > 1
              const expanded = expandable && expandedIds.has(call.id)
              return (
                <Fragment key={call.id}>
                  <tr className={cn("transition-colors hover:bg-zinc-900/40", WORKSPACE_TABLE_ROW_CLASS)}>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      <ActivityStatusPill status={st} />
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      <div className="flex items-center gap-1">
                        <CallTimeDisplay call={call} />
                        {expandable ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(call.id)}
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                            aria-label={expanded ? "Hide call times" : "Show all call times"}
                            aria-expanded={expanded}
                          >
                            <ChevronDown
                              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                              aria-hidden
                            />
                          </button>
                        ) : null}
                      </div>
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      <button
                        type="button"
                        onClick={() => {
                          if (expandable) toggleExpanded(call.id)
                        }}
                        className={cn(
                          "w-full min-w-0 text-left",
                          expandable && "cursor-pointer"
                        )}
                        disabled={!expandable}
                      >
                        <CallerNameWithCount call={call} />
                      </button>
                      {canCallBack(call) ? (
                        <a
                          href={buildTelHref(call.callerNumber) ?? undefined}
                          className="block truncate text-xs font-medium text-cyan-400 underline-offset-2 hover:underline"
                          title={call.callerNumber}
                        >
                          {call.callerNumber}
                        </a>
                      ) : (
                        <p className="truncate text-xs text-zinc-500" title={call.callerNumber}>
                          {call.callerNumber}
                        </p>
                      )}
                      {expanded ? <GroupedCallChronology members={call.members} /> : null}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      {call.activity ? (
                        <ActivityIntakeSummary
                          activity={call.activity}
                          compact
                          callerPhone={call.callerNumber}
                        />
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle tabular-nums text-sm text-zinc-300">
                      {formatDuration(call.durationSeconds)}
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      {call.count > 1 ? (
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
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle">
                      <p className="truncate text-sm font-medium text-zinc-200" title={targetLabel}>
                        {targetLabel}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={call.routedTo}>
                        {formatRoutedToLabel(call.routedTo)}
                      </p>
                    </WorkspaceTd>
                    <WorkspaceTd className="!px-3 !py-2.5 align-middle text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {canCallBack(call) ? (
                          <CallBackButton
                            phone={call.callerNumber}
                            compact
                            openIntakeDraft={needsRevenueRescue(call)}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedActivityLog(call)
                            openLog(call)
                          }}
                          className="inline-flex h-8 items-center rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-foreground"
                        >
                          Log
                        </button>
                      </div>
                    </WorkspaceTd>
                  </tr>
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
  loadError: string | null
  refreshing: boolean
  lineLabelMap: Map<string, string>
  filter: ActivityCallFilter
  onFilterChange: (next: ActivityCallFilter) => void
}

const ActivityWorkspaceBody = memo(function ActivityWorkspaceBody({
  calls,
  loading,
  loadError,
  refreshing,
  lineLabelMap,
  filter,
  onFilterChange,
}: ActivityBodyProps) {
  const { activeLine } = useDashboardWorkspace()
  const isMobile = useIsMobile()

  const scopedCalls = useMemo(() => {
    if (!activeLine) return calls
    return calls.filter((c) => businessNumbersMatch(c.targetLineE164, activeLine))
  }, [calls, activeLine])

  const missedCount = useMemo(
    () => scopedCalls.filter((c) => isMissedActivityCallToday(c)).length,
    [scopedCalls]
  )

  const rows = useMemo(() => {
    let list = scopedCalls
    if (filter === "missed") {
      list = list.filter((c) => isMissedActivityCallToday(c))
    }
    const sorted = [...list].sort((a, b) => {
      const aTs = a.createdAt || `${a.date} ${a.time}`
      const bTs = b.createdAt || `${b.date} ${b.time}`
      return bTs.localeCompare(aTs)
    })
    // Fold back-to-back repeats from the same number into one feed row.
    return groupConsecutiveCallsByPhone(sorted)
  }, [scopedCalls, filter])

  const showMapFirst = !isMobile || filter !== "missed"

  const callList = (
    <>
      <ActivityCallFilterBar filter={filter} missedCount={missedCount} onChange={onFilterChange} />
      {filter === "missed" && rows.length === 0 && !loading ? (
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-10 text-center">
          <PhoneMissed className="mx-auto mb-2 h-8 w-8 text-amber-400/80" aria-hidden />
          <p className="text-sm font-medium text-zinc-200">No missed calls today</p>
          <p className="mt-1 text-xs text-zinc-500">This list resets at midnight. Yesterday’s missed calls stay in All calls.</p>
        </div>
      ) : null}
      {loading && calls.length === 0 ? (
        <ActivityTableSkeleton />
      ) : loadError && calls.length === 0 ? (
        <p className="min-h-[380px] text-sm text-destructive">{loadError}</p>
      ) : (
        <ActivityCallsTable rows={rows} lineLabelMap={lineLabelMap} />
      )}
    </>
  )

  const mapSection = (
    <>
      <DispatchLiveMap />
      <DispatchJobsPanel />
    </>
  )

  return (
    <WorkspacePage>
      <WorkspacePageHeader
        eyebrow="Live"
        title={filter === "missed" ? "Missed calls today" : "Activities"}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {refreshing ? (
              <p className="text-xs text-zinc-600" aria-live="polite">
                Refreshing…
              </p>
            ) : null}
            <Link
              href="/dashboard/scheduler"
              className="hidden items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/15 sm:inline-flex"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Job scheduler
            </Link>
          </div>
        }
      />

      {showMapFirst ? (
        <>
          {mapSection}
          {callList}
        </>
      ) : (
        <>
          {callList}
          {mapSection}
        </>
      )}
    </WorkspacePage>
  )
})

function useLineLabelMap(): Map<string, string> {
  const { businessNumbers } = useDashboardWorkspace()

  return useMemo(() => {
    if (businessNumbers.length === 0) return new Map<string, string>()
    const entries: LineLabelEntry[] = businessNumbers.map((n) => ({
      number: n.number,
      label: n.label ?? "Business Line",
    }))
    return buildBusinessLineLabelMap(entries)
  }, [businessNumbers])
}

export const ActivityWorkspaceView = memo(function ActivityWorkspaceView() {
  const { calls, loading, loadError, refreshing } = useOperationsData({ refetchIntervalMs: 12_000 })
  const { setActivityLogs, closeActivityLog } = useDashboardWorkspace()
  const lineLabelMap = useLineLabelMap()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [filter, setFilter] = useState<ActivityCallFilter>(() => {
    if (searchParams.get("filter") === "missed") return "missed"
    return "all"
  })
  useBookingAlerts()

  useEffect(() => {
    const param = searchParams.get("filter")
    if (param === "missed") setFilter("missed")
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
    setActivityLogs(calls)
  }, [calls, setActivityLogs])

  return (
    <WorkspaceRightSheetGate<UiCallRecord>
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
        loadError={loadError}
        refreshing={refreshing}
        lineLabelMap={lineLabelMap}
        filter={filter}
        onFilterChange={handleFilterChange}
      />
    </WorkspaceRightSheetGate>
  )
})
