"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
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
  WorkspaceBloom,
} from "@/components/workspace-content-skeletons"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"
import { DispatchJobsPanel } from "@/components/workspace-views/dispatch-jobs-panel"
import { DispatchLiveMap } from "@/components/workspace-views/dispatch-live-map"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useOperationsData, type UiCallRecord } from "@/lib/hooks/use-operations-data"
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
function useBookingAlerts() {
  const { toast } = useToast()
  const sinceRef = useRef<string>(new Date().toISOString())
  const seenRef = useRef<Set<string>>(new Set())

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
          playBookingPing()
          toast({
            title: "New booking confirmed",
            description: `${formatCallerNumber(b.caller)}${b.summary ? ` — ${b.summary}` : ""}`,
          })
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
  }, [toast])
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

function CallLogSheet({ call, onClose }: { call: UiCallRecord; onClose: () => void }) {
  const agent = resolveCallAgent(call)
  const summary = buildCallSummary(call)
  return (
    <>
      <DrawerStepHeader
        step="Log"
        title="Call detail"
        subtitle={`${call.callerName} · ${call.callerNumber}`}
      />
      <DrawerScrollBody>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-400">
              {formatDuration(call.durationSeconds)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
              {formatCallTimestamp(call)}
            </span>
          </div>

          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />
              Lyncr AI Call Summary &amp; Notes
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

const ActivityCallsTable = memo(function ActivityCallsTable({ rows, lineLabelMap }: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()

  return (
    <WorkspacePanel className="min-h-[380px]">
      <WorkspaceTableWrap className="min-h-[340px]">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[24%]" />
          <col className="w-[10%]" />
          <col className="w-[20%]" />
          <col className="w-[22%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr>
            <WorkspaceTh>Status</WorkspaceTh>
            <WorkspaceTh>Caller</WorkspaceTh>
            <WorkspaceTh>Duration</WorkspaceTh>
            <WorkspaceTh>Agent</WorkspaceTh>
            <WorkspaceTh>Target line</WorkspaceTh>
            <WorkspaceTh />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <WorkspaceTd colSpan={6} className="py-12 text-center text-zinc-600">
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
    </WorkspacePanel>
  )
})

type ActivityBodyProps = {
  loading: boolean
  loadError: string | null
  refreshing: boolean
  lineLabelMap: Map<string, string>
}

const ActivityWorkspaceBody = memo(function ActivityWorkspaceBody({
  loading,
  loadError,
  refreshing,
  lineLabelMap,
}: ActivityBodyProps) {
  const { activityLogs, activeLine } = useDashboardWorkspace()

  const rows = useMemo(() => {
    let list = activityLogs
    if (activeLine) {
      list = list.filter((c) => businessNumbersMatch(c.targetLineE164, activeLine))
    }
    return [...list].sort((a, b) => {
      const aTs = a.createdAt || `${a.date} ${a.time}`
      const bTs = b.createdAt || `${b.date} ${b.time}`
      return bTs.localeCompare(aTs)
    })
  }, [activityLogs, activeLine])

  return (
    <WorkspacePage>
      <WorkspacePageHeader
        eyebrow="Live"
        title="Activity"
        action={
          activeLine ? (
            <p className="text-xs text-zinc-500">
              Filtered to active line ·{" "}
              <span className="font-medium text-zinc-300">{resolveBusinessLineLabel(activeLine, lineLabelMap)}</span>
            </p>
          ) : null
        }
      />

      {refreshing ? <p className="text-xs text-zinc-600">Refreshing…</p> : null}

      <DispatchLiveMap />

      <DispatchJobsPanel />

      {loading && activityLogs.length === 0 ? (
        <ActivityTableSkeleton />
      ) : loadError && activityLogs.length === 0 ? (
        <p className="min-h-[380px] text-sm text-destructive">{loadError}</p>
      ) : (
        <WorkspaceBloom>
          <ActivityCallsTable rows={rows} lineLabelMap={lineLabelMap} />
        </WorkspaceBloom>
      )}
    </WorkspacePage>
  )
})

function useLineLabelMap(): Map<string, string> {
  const { businessNumbers } = useDashboardWorkspace()
  const [fetched, setFetched] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (businessNumbers.length > 0) {
      const entries: LineLabelEntry[] = businessNumbers.map((n) => ({
        number: n.number,
        label: "Business Line",
      }))
      setFetched(buildBusinessLineLabelMap(entries))
      return
    }
    let cancelled = false
    fetch("/api/numbers/mine", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data) => {
        if (cancelled) return
        const numbers = Array.isArray(data.numbers) ? data.numbers : []
        const entries: LineLabelEntry[] = numbers.map((n: { number?: string; label?: string }) => ({
          number: String(n.number ?? ""),
          label: String(n.label ?? "Business Line"),
        }))
        setFetched(buildBusinessLineLabelMap(entries))
      })
      .catch(() => {
        if (!cancelled) setFetched(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [businessNumbers])

  return fetched
}

export const ActivityWorkspaceView = memo(function ActivityWorkspaceView() {
  const { calls, loading, loadError, refreshing } = useOperationsData({ refetchIntervalMs: 12_000 })
  const { setActivityLogs, closeActivityLog } = useDashboardWorkspace()
  const lineLabelMap = useLineLabelMap()
  useBookingAlerts()

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
        loading={loading}
        loadError={loadError}
        refreshing={refreshing}
        lineLabelMap={lineLabelMap}
      />
    </WorkspaceRightSheetGate>
  )
})
