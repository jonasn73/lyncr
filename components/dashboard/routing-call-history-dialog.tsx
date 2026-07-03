"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  Clock,
  Loader2,
  Phone,
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
import { formatTalkDuration, formatTalkTime, isLocalCalendarThisWeek, isLocalCalendarToday } from "@/lib/daily-call-telemetry"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { buildTelHref } from "@/lib/phone-e164"

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
    description: "Calls with talk time this week — see which days were busiest.",
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
  return isLocalCalendarToday(iso)
}

function isThisWeek(iso: string): boolean {
  return isLocalCalendarThisWeek(iso)
}

function isMissedRow(row: CallHistoryRow): boolean {
  return isMissedCallRecord({
    call_type: row.call_type,
    status: row.status,
    answered_at: row.answered_at,
    ended_at: row.ended_at,
    routed_to_name: row.routed_to_name,
  })
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

/** One calendar day in the current week (Mon–Sun) for the weekly talk breakdown. */
type WeeklyDayBucket = {
  key: string
  weekdayLabel: string
  dateLabel: string
  callCount: number
  talkSeconds: number
  isToday: boolean
  isFuture: boolean
}

/** Stable YYYY-MM-DD key in local time — groups calls onto the owner's calendar day. */
function localDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Monday 00:00 of the current local week. */
function startOfLocalWeek(now = new Date()): Date {
  const start = new Date(now)
  const weekday = start.getDay()
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - daysFromMonday)
  return start
}

/** Build Mon–Sun buckets with call + talk totals (zeros on quiet days). */
function buildWeeklyDayBreakdown(rows: CallHistoryRow[]): WeeklyDayBucket[] {
  const now = new Date()
  const todayKey = localDateKey(now)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = startOfLocalWeek(now)
  const buckets: WeeklyDayBucket[] = []

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    const key = localDateKey(date)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    buckets.push({
      key,
      weekdayLabel: date.toLocaleDateString([], { weekday: "short" }),
      dateLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      callCount: 0,
      talkSeconds: 0,
      isToday: key === todayKey,
      isFuture: dayStart > todayStart,
    })
  }

  const indexByKey = new Map(buckets.map((b, i) => [b.key, i]))
  for (const row of rows) {
    const idx = indexByKey.get(localDateKey(row.created_at))
    if (idx == null) continue
    buckets[idx].callCount += 1
    buckets[idx].talkSeconds += effectiveTalkSeconds(row)
  }

  return buckets
}

function WeeklyDayBreakdownChart({
  days,
  selectedDayKey,
  onSelectDay,
}: {
  days: WeeklyDayBucket[]
  selectedDayKey: string | null
  onSelectDay: (key: string | null) => void
}) {
  const maxCalls = Math.max(1, ...days.map((d) => d.callCount))
  const busiest = days.reduce((best, d) => (d.callCount > best.callCount ? d : best), days[0])
  const quietDays = days.filter((d) => !d.isFuture && d.callCount === 0)
  const hasActivity = days.some((d) => d.callCount > 0)

  return (
    <section className="border-b border-zinc-800/80 px-4 py-3" aria-label="Calls by day this week">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">By day</p>
        {hasActivity ? (
          <p className="text-[11px] text-zinc-500">
            Busiest:{" "}
            <span className="font-medium text-teal-400">
              {busiest.weekdayLabel} ({busiest.callCount} call{busiest.callCount === 1 ? "" : "s"})
            </span>
            {quietDays.length > 0 ? (
              <span className="text-zinc-600">
                {" "}
                · Quiet: {quietDays.map((d) => d.weekdayLabel).join(", ")}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {days.map((day) => {
          const barPct = day.callCount > 0 ? Math.round((day.callCount / maxCalls) * 100) : 0
          const isSelected = selectedDayKey === day.key
          const isMuted = day.isFuture || (day.callCount === 0 && !day.isToday)

          return (
            <li key={day.key}>
              <button
                type="button"
                onClick={() => onSelectDay(isSelected ? null : day.key)}
                disabled={day.isFuture}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
                  day.isFuture && "cursor-not-allowed opacity-40",
                  !day.isFuture && "hover:bg-zinc-900/60",
                  isSelected && "bg-teal-950/40 ring-1 ring-teal-500/30"
                )}
                aria-pressed={isSelected}
                aria-label={`${day.weekdayLabel} ${day.dateLabel}: ${day.callCount} calls, ${formatTalkDuration(day.talkSeconds)} talk`}
              >
                <div className="w-14 shrink-0">
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      day.isToday ? "text-teal-300" : isMuted ? "text-zinc-600" : "text-zinc-300"
                    )}
                  >
                    {day.weekdayLabel}
                  </p>
                  <p className="text-[10px] text-zinc-600">{day.dateLabel}</p>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800/80">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        day.callCount > 0 ? "bg-teal-500/80" : "bg-zinc-700/40"
                      )}
                      style={{ width: `${Math.max(day.callCount > 0 ? 8 : 0, barPct)}%` }}
                    />
                  </div>
                </div>

                <div className="w-20 shrink-0 text-right">
                  <p
                    className={cn(
                      "text-xs font-bold tabular-nums",
                      day.callCount > 0 ? "text-zinc-100" : "text-zinc-600"
                    )}
                  >
                    {day.callCount} call{day.callCount === 1 ? "" : "s"}
                  </p>
                  <p className="text-[10px] tabular-nums text-zinc-500">
                    {day.talkSeconds > 0 ? formatTalkDuration(day.talkSeconds) : "—"}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {selectedDayKey ? (
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          Showing {days.find((d) => d.key === selectedDayKey)?.weekdayLabel ?? "day"} only ·{" "}
          <button
            type="button"
            className="text-teal-400 underline-offset-2 hover:underline"
            onClick={() => onSelectDay(null)}
          >
            Show all week
          </button>
        </p>
      ) : (
        <p className="mt-2 text-center text-[11px] text-zinc-600">Tap a day to filter the list below</p>
      )}
    </section>
  )
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
  const [selectedWeekDayKey, setSelectedWeekDayKey] = useState<string | null>(null)

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
    else setSelectedWeekDayKey(null)
  }, [open, loadCalls])

  const filtered = useMemo(
    () => filterRows(rows, filter, businessNumbers),
    [rows, filter, businessNumbers]
  )

  const weeklyDayBreakdown = useMemo(
    () => (filter === "weekly_talk" ? buildWeeklyDayBreakdown(filtered) : []),
    [filter, filtered]
  )

  const listRows = useMemo(() => {
    if (filter !== "weekly_talk" || !selectedWeekDayKey) return filtered
    return filtered.filter((row) => localDateKey(row.created_at) === selectedWeekDayKey)
  }, [filter, filtered, selectedWeekDayKey])

  const summary = useMemo(() => buildSummary(listRows), [listRows])
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

        {filter === "weekly_talk" && !loading && !error && weeklyDayBreakdown.length > 0 ? (
          <WeeklyDayBreakdownChart
            days={weeklyDayBreakdown}
            selectedDayKey={selectedWeekDayKey}
            onSelectDay={setSelectedWeekDayKey}
          />
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
          ) : listRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No calls on this day.</p>
          ) : (
            <ul className="space-y-2">
              {listRows.map((call) => {
                const talkSec = effectiveTalkSeconds(call)
                const callBackHref =
                  filter === "missed" || isMissedRow(call) ? buildTelHref(call.from_number) : null
                return (
                  <li
                    key={call.id}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <DirectionIcon callType={call.call_type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          {callBackHref ? (
                            <a
                              href={callBackHref}
                              className="truncate text-sm font-medium text-cyan-300 underline-offset-2 hover:underline"
                            >
                              {formatPhoneDisplay(call.from_number)}
                            </a>
                          ) : (
                            <p className="truncate text-sm font-medium text-zinc-100">
                              {formatPhoneDisplay(call.from_number)}
                            </p>
                          )}
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
                        {callBackHref ? (
                          <a
                            href={callBackHref}
                            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/15 active:scale-[0.98]"
                          >
                            <Phone className="h-4 w-4 shrink-0" aria-hidden />
                            Call back
                          </a>
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
          {listRows.length} call{listRows.length === 1 ? "" : "s"}
          {selectedWeekDayKey ? " this day" : filter === "weekly_talk" ? " this week" : ""}
          {showTalkSummary && summary.totalTalkSeconds > 0
            ? ` · ${formatTalkDuration(summary.totalTalkSeconds)} total talk`
            : ""}{" "}
          · tap a stat pill to reopen
        </div>
      </DialogContent>
    </Dialog>
  )
})
