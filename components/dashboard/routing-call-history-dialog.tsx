"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  Clock,
  Loader2,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Users,
  Voicemail,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatTalkDuration, formatTalkTime } from "@/lib/daily-call-telemetry"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"

export type CallHistoryFilter = "daily" | "missed" | "daily_talk" | "weekly_talk"

type CallHistoryRow = {
  id: string
  call_type: string
  from_number: string
  to_number: string
  created_at: string
  duration_seconds: number
  recording_url: string | null
  recording_duration_seconds: number | null
  routed_to_name: string | null
  status: string
  answered_at?: string | null
  ended_at?: string | null
}

type CallSummary = {
  callCount: number
  uniqueCallers: number
  totalTalkSeconds: number
  answeredCount: number
  avgTalkSeconds: number
}

const FILTER_META: Record<
  CallHistoryFilter,
  { title: string; description: string; emptyMessage: string }
> = {
  daily: {
    title: "Call history today",
    description: "Every inbound and outbound call logged today for this workspace.",
    emptyMessage: "No calls logged today for this workspace.",
  },
  missed: {
    title: "Missed calls today",
    description: "Inbound calls you missed today on this workspace.",
    emptyMessage: "No missed calls today — nice work.",
  },
  daily_talk: {
    title: "Daily talk summary",
    description: "Calls with talk time today — who called, how long, and who answered.",
    emptyMessage: "No talk time logged yet today.",
  },
  weekly_talk: {
    title: "Weekly talk summary",
    description: "Calls with talk time this week (since Monday).",
    emptyMessage: "No talk time logged yet this week.",
  },
}

function formatPhoneDisplay(num: string): string {
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num || "Unknown"
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  if (m < 60) return `${m}m ${r.toString().padStart(2, "0")}s`
  return formatTalkDuration(s)
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (sameDay) return `Today, ${time}`
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const startOfWeek = new Date(now)
  const day = startOfWeek.getDay()
  const diff = day === 0 ? 6 : day - 1
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(startOfWeek.getDate() - diff)
  return d >= startOfWeek
}

function isMissedRow(row: CallHistoryRow): boolean {
  const type = row.call_type.toLowerCase()
  const status = row.status.toLowerCase()
  return (
    type === "missed" ||
    type === "voicemail" ||
    status.includes("no-answer") ||
    status.includes("busy") ||
    status.includes("missed") ||
    status.includes("canceled") ||
    status.includes("cancelled")
  )
}

/** Match HUD talk-time logic: duration, recording, or answered→ended delta. */
function effectiveTalkSeconds(row: CallHistoryRow): number {
  let best = Math.max(0, row.duration_seconds, row.recording_duration_seconds ?? 0)
  if (row.answered_at && row.ended_at) {
    const a = new Date(row.answered_at).getTime()
    const e = new Date(row.ended_at).getTime()
    if (Number.isFinite(a) && Number.isFinite(e) && e > a) {
      best = Math.max(best, Math.round((e - a) / 1000))
    }
  }
  return best
}

function isTalkableRow(row: CallHistoryRow): boolean {
  if (effectiveTalkSeconds(row) > 0) return true
  const status = row.status.toLowerCase()
  return (
    (status === "completed" || status === "in-progress" || status === "answered") &&
    row.call_type.toLowerCase() !== "missed"
  )
}

function matchesWorkspaceLine(row: CallHistoryRow, businessNumbers: DashboardBusinessNumber[]): boolean {
  if (businessNumbers.length === 0) return true
  return businessNumbers.some((line) => businessNumbersMatch(row.to_number, line.number))
}

function filterRows(
  rows: CallHistoryRow[],
  filter: CallHistoryFilter,
  businessNumbers: DashboardBusinessNumber[]
): CallHistoryRow[] {
  return rows
    .filter((row) => {
      if (!matchesWorkspaceLine(row, businessNumbers)) return false
      if (filter === "daily" || filter === "missed" || filter === "daily_talk") {
        if (!isToday(row.created_at)) return false
      }
      if (filter === "weekly_talk") {
        if (!isThisWeek(row.created_at)) return false
      }
      if (filter === "missed") return isMissedRow(row)
      if (filter === "daily_talk" || filter === "weekly_talk") return isTalkableRow(row)
      return true
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function buildSummary(rows: CallHistoryRow[]): CallSummary {
  const callers = new Set<string>()
  let totalTalkSeconds = 0
  let answeredCount = 0
  for (const row of rows) {
    callers.add(row.from_number.replace(/\D/g, "") || row.from_number)
    const talk = effectiveTalkSeconds(row)
    totalTalkSeconds += talk
    if (talk > 0 || ["completed", "in-progress", "answered"].includes(row.status.toLowerCase())) {
      answeredCount += 1
    }
  }
  return {
    callCount: rows.length,
    uniqueCallers: callers.size,
    totalTalkSeconds,
    answeredCount,
    avgTalkSeconds: rows.length > 0 ? Math.round(totalTalkSeconds / rows.length) : 0,
  }
}

function DirectionIcon({ callType }: { callType: string }) {
  const t = callType.toLowerCase()
  if (t === "outgoing") return <PhoneOutgoing className="h-4 w-4 shrink-0 text-teal-400" aria-hidden />
  if (t === "missed") return <PhoneMissed className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
  if (t === "voicemail") return <Voicemail className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
  return <PhoneIncoming className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string
  value: string
  icon: typeof Clock
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        highlight ? "border-teal-500/30 bg-teal-950/30" : "border-zinc-800/80 bg-zinc-900/40"
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </div>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", highlight ? "text-teal-300" : "text-zinc-100")}>
        {value}
      </p>
    </div>
  )
}

export const RoutingCallHistoryDialog = memo(function RoutingCallHistoryDialog({
  open,
  onOpenChange,
  filter,
  businessNumbers,
  expectedTalkSeconds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: CallHistoryFilter
  businessNumbers: DashboardBusinessNumber[]
  /** HUD total for talk filters — shown for comparison when it differs from row sum. */
  expectedTalkSeconds?: number
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CallHistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadCalls = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const limit = filter === "weekly_talk" ? 250 : 150
      const res = await fetch(`/api/calls?limit=${limit}`, { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error("Could not load call history")
      const json = (await res.json()) as { calls?: CallHistoryRow[] }
      setRows(Array.isArray(json.calls) ? json.calls : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calls")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (open) void loadCalls()
  }, [open, loadCalls])

  const filtered = useMemo(
    () => filterRows(rows, filter, businessNumbers),
    [rows, filter, businessNumbers]
  )

  const summary = useMemo(() => buildSummary(filtered), [filtered])
  const meta = FILTER_META[filter]
  const showTalkSummary = filter === "daily_talk" || filter === "weekly_talk"
  const hudTalkDisplay =
    expectedTalkSeconds != null && expectedTalkSeconds > 0
      ? filter === "daily_talk"
        ? formatTalkTime(expectedTalkSeconds)
        : formatTalkDuration(expectedTalkSeconds)
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,820px)] overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-zinc-800 px-5 py-4">
          <DialogTitle className="text-base text-zinc-50">{meta.title}</DialogTitle>
          <DialogDescription className="text-zinc-400">{meta.description}</DialogDescription>
        </DialogHeader>

        {showTalkSummary && !loading && !error ? (
          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800/80 px-4 py-3 sm:grid-cols-4">
            <SummaryStat
              label="Total talk"
              value={formatTalkDuration(summary.totalTalkSeconds)}
              icon={Clock}
              highlight
            />
            <SummaryStat label="Calls" value={String(summary.callCount)} icon={PhoneIncoming} />
            <SummaryStat label="Answered" value={String(summary.answeredCount)} icon={PhoneIncoming} />
            <SummaryStat label="Callers" value={String(summary.uniqueCallers)} icon={Users} />
          </div>
        ) : null}

        {!loading && !error && showTalkSummary && summary.callCount > 0 ? (
          <div className="border-b border-zinc-800/60 px-5 py-2 text-xs text-zinc-500">
            Avg {formatDuration(summary.avgTalkSeconds)} per call
            {hudTalkDisplay ? (
              <span className="text-zinc-600">
                {" "}
                · HUD shows {hudTalkDisplay}
                {summary.totalTalkSeconds !== expectedTalkSeconds ? " (includes all workspace lines)" : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="max-h-[min(55vh,560px)] overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading calls…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">{meta.emptyMessage}</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((call) => {
                const talkSec = effectiveTalkSeconds(call)
                return (
                  <li
                    key={call.id}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <DirectionIcon callType={call.call_type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {formatPhoneDisplay(call.from_number)}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 text-xs tabular-nums font-semibold",
                              talkSec > 0 ? "text-teal-400" : "text-zinc-500"
                            )}
                          >
                            {talkSec > 0 ? formatDuration(talkSec) : "0s"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">{formatTimestamp(call.created_at)}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                          {call.routed_to_name ? (
                            <span>
                              Answered by{" "}
                              <span className="text-zinc-400">{call.routed_to_name}</span>
                            </span>
                          ) : null}
                          <span className="capitalize">{call.status.replace(/-/g, " ") || "unknown"}</span>
                          <span>To {formatPhoneDisplay(call.to_number)}</span>
                        </div>
                        {call.recording_url ? (
                          <audio
                            src={call.recording_url}
                            controls
                            preload="none"
                            className="mt-2 h-8 w-full accent-cyan-400 opacity-80"
                          />
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-800 px-5 py-2 text-center text-[11px] text-zinc-600">
          {filtered.length} call{filtered.length === 1 ? "" : "s"}
          {showTalkSummary && summary.totalTalkSeconds > 0
            ? ` · ${formatTalkDuration(summary.totalTalkSeconds)} total talk`
            : ""}{" "}
          · tap a stat pill to reopen
        </div>
      </DialogContent>
    </Dialog>
  )
})
