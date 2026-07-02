"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarDays, ClipboardList, MapPin, Phone, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTelHref } from "@/lib/phone-e164"
import { isLocalCalendarToday } from "@/lib/daily-call-telemetry"
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

/** e.g. "Today, 4:15 PM" or "May 25, 2:30 PM" */
function formatCallTimestamp(call: UiCallRecord): string {
  if (call.createdAt) {
    const d = new Date(call.createdAt)
    if (!Number.isNaN(d.getTime())) {
      const now = new Date()
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const diffDays = Math.floor((startToday - startThatDay) / 86_400_000)
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      if (diffDays === 0) return `Today, ${time}`
      if (diffDays === 1) return `Yesterday, ${time}`
      return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`
    }
  }
  if (call.date && call.time) return `${call.date}, ${call.time}`
  return "—"
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

function classifyCall(call: UiCallRecord): ActivityCallStatus {
  const routed = call.routedTo ?? ""
  if (call.type === "voicemail") return "voicemail"
  if (call.type === "missed") return "missed"
  if (/ai receptionist|voice ai|assistant/i.test(routed)) return "ai_handled"
  if (call.durationSeconds > 0) return "answered"
  return "missed"
}

type ActivityCallFilter = "all" | "missed"

function isMissedActivityCall(call: UiCallRecord): boolean {
  if (call.type === "outgoing") return false
  const status = classifyCall(call)
  return status === "missed" || status === "voicemail"
}

/** Missed inbound/voicemail on the owner’s local calendar day (resets at midnight). */
function isMissedActivityCallToday(call: UiCallRecord, now: Date = new Date()): boolean {
  if (!isMissedActivityCall(call)) return false
  if (!call.createdAt) return false
  return isLocalCalendarToday(call.createdAt, now)
}

function canCallBack(call: UiCallRecord): boolean {
  return isMissedActivityCall(call) && buildTelHref(call.callerNumber) != null
}

function CallBackButton({
  phone,
  className,
  compact = false,
}: {
  phone: string
  className?: string
  compact?: boolean
}) {
  const href = buildTelHref(phone)
  if (!href) return null
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 font-semibold text-cyan-200 transition hover:bg-cyan-500/15 active:scale-[0.98]",
        compact ? "min-h-10 px-3 py-2 text-xs" : "min-h-11 w-full px-4 py-2.5 text-sm",
        className
      )}
    >
      <Phone className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      Call back
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
    { id: "missed", label: "Missed today", badge: missedCount },
    { id: "all", label: "All calls" },
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

function AgentBadge({ agent }: { agent: CallAgent }) {
  if (agent.kind === "none") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-800/40 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
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
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
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
      <span className="truncate">Answered by: {agent.label}</span>
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
}: {
  activity: CallActivityContext
  compact?: boolean
}) {
  const schedulerHref = activity.leadId
    ? buildSchedulerFocusUrl(activity.leadId, { schedule: !activity.scheduleAt })
    : null

  return (
    <div className={cn("space-y-1", compact && "space-y-0.5")}>
      <span
        className={cn(
          "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          intakeActionTone(activity.intakeAction)
        )}
      >
        {activity.intakeAction}
      </span>
      {activity.intakeDetail ? (
        <p className={cn("text-zinc-400", compact ? "text-[11px] leading-snug" : "text-xs leading-relaxed")}>
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
          {showCallBack ? <CallBackButton phone={call.callerNumber} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-400">
              {formatDuration(call.durationSeconds)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
              {formatCallTimestamp(call)}
            </span>
          </div>

          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              Answered panel &amp; scheduling
            </p>
            <div className="mt-3">
              <ActivityIntakeSummary activity={activity} />
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
  rows: UiCallRecord[]
  lineLabelMap: Map<string, string>
}

const ActivityCallsMobileList = memo(function ActivityCallsMobileList({
  rows,
  lineLabelMap,
}: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()

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
        return (
          <li key={call.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedActivityLog(call)
                openLog(call)
              }}
              className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-zinc-900/50 active:bg-zinc-900/70"
            >
              <div className="flex items-center justify-between gap-2">
                <ActivityStatusPill status={st} />
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {formatDuration(call.durationSeconds)}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{call.callerName}</p>
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
              {canCallBack(call) ? (
                <CallBackButton phone={call.callerNumber} compact className="w-full" />
              ) : null}
              {call.activity ? (
                <ActivityIntakeSummary activity={call.activity} compact />
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <AgentBadge agent={resolveCallAgent(call)} />
                <span className="truncate" title={targetLabel}>
                  {targetLabel}
                </span>
              </div>
              <p className="text-[11px] tabular-nums text-zinc-600">{formatCallTimestamp(call)}</p>
            </button>
          </li>
        )
      })}
    </ul>
  )
})

const ActivityCallsTable = memo(function ActivityCallsTable({ rows, lineLabelMap }: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()

  return (
    <WorkspacePanel className="min-h-[380px]">
      <div className="md:hidden">
        <ActivityCallsMobileList rows={rows} lineLabelMap={lineLabelMap} />
      </div>
      <div className="hidden md:block">
      <WorkspaceTableWrap className="min-h-[340px]" bleed>
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[18%]" />
          <col className="w-[24%]" />
          <col className="w-[8%]" />
          <col className="w-[16%]" />
          <col className="w-[15%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr>
            <WorkspaceTh>Status</WorkspaceTh>
            <WorkspaceTh>Caller</WorkspaceTh>
            <WorkspaceTh>Intake &amp; schedule</WorkspaceTh>
            <WorkspaceTh>Duration</WorkspaceTh>
            <WorkspaceTh>Agent</WorkspaceTh>
            <WorkspaceTh>Target line</WorkspaceTh>
            <WorkspaceTh />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <WorkspaceTd colSpan={7} className="py-12 text-center text-zinc-600">
                No calls yet
              </WorkspaceTd>
            </tr>
          ) : (
            rows.map((call) => {
              const st = classifyCall(call)
              const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)
              return (
                <tr key={call.id} className={cn("transition-colors hover:bg-zinc-900/50", WORKSPACE_TABLE_ROW_CLASS)}>
                  <WorkspaceTd>
                    <ActivityStatusPill status={st} />
                  </WorkspaceTd>
                  <WorkspaceTd>
                    <p className="font-medium text-foreground">{call.callerName}</p>
                    <p className="text-xs text-zinc-500">{call.callerNumber}</p>
                    <p className="mt-1 text-[11px] tabular-nums text-zinc-600">
                      {formatCallTimestamp(call)}
                    </p>
                  </WorkspaceTd>
                  <WorkspaceTd>
                    {call.activity ? (
                      <ActivityIntakeSummary activity={call.activity} compact />
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </WorkspaceTd>
                  <WorkspaceTd className="tabular-nums text-zinc-400">
                    {formatDuration(call.durationSeconds)}
                  </WorkspaceTd>
                  <WorkspaceTd>
                    <AgentBadge agent={resolveCallAgent(call)} />
                  </WorkspaceTd>
                  <WorkspaceTd>
                    <p className="truncate font-medium text-zinc-200" title={targetLabel}>
                      {targetLabel}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-zinc-500" title={call.routedTo}>
                      {formatRoutedToLabel(call.routedTo)}
                    </p>
                  </WorkspaceTd>
                  <WorkspaceTd className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedActivityLog(call)
                        openLog(call)
                      }}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
                    >
                      View log
                    </button>
                  </WorkspaceTd>
                </tr>
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
  missedCount: number
  onFilterChange: (next: ActivityCallFilter) => void
}

const ActivityWorkspaceBody = memo(function ActivityWorkspaceBody({
  calls,
  loading,
  loadError,
  refreshing,
  lineLabelMap,
  filter,
  missedCount,
  onFilterChange,
}: ActivityBodyProps) {
  const { activeLine } = useDashboardWorkspace()
  const isMobile = useIsMobile()

  const rows = useMemo(() => {
    let list = calls
    if (activeLine) {
      list = list.filter((c) => businessNumbersMatch(c.targetLineE164, activeLine))
    }
    if (filter === "missed") {
      list = list.filter((c) => isMissedActivityCallToday(c))
    }
    return [...list].sort((a, b) => {
      const aTs = a.createdAt || `${a.date} ${a.time}`
      const bTs = b.createdAt || `${b.date} ${b.time}`
      return bTs.localeCompare(aTs)
    })
  }, [calls, activeLine, filter])

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
        title={filter === "missed" ? "Missed calls today" : "Activity"}
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
            {activeLine ? (
              <p className="text-xs text-zinc-500">
                Filtered to active line ·{" "}
                <span className="font-medium text-zinc-300">{resolveBusinessLineLabel(activeLine, lineLabelMap)}</span>
              </p>
            ) : null}
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
    if (searchParams.get("filter") === "all") return "all"
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) return "missed"
    return "all"
  })
  useBookingAlerts()

  useEffect(() => {
    const param = searchParams.get("filter")
    if (param === "missed") setFilter("missed")
    else if (param === "all") setFilter("all")
  }, [searchParams])

  const missedCount = useMemo(
    () => calls.filter((c) => isMissedActivityCallToday(c)).length,
    [calls]
  )

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
        missedCount={missedCount}
        onFilterChange={handleFilterChange}
      />
    </WorkspaceRightSheetGate>
  )
})
