"use client"

import { useMemo, useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  PhoneMissed,
  Voicemail,
  Clock,
  Search,
  Filter,
  Download,
  Phone,
  Gauge,
  CheckCircle2,
  Timer,
  Loader2,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useOperationsData, type UiCallRecord } from "@/lib/hooks/use-operations-data"
import { EmptyState } from "@/components/ui/empty-state"
import { IconSurface } from "@/components/ui/icon-surface"

type CallType = "incoming" | "outgoing" | "missed" | "voicemail"
type FilterType = "all" | CallType

type CallRecord = UiCallRecord

function formatDuration(seconds: number): string {
  if (seconds === 0) return "--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

function formatDurationLong(seconds: number): string {
  if (seconds === 0) return "No call duration"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m} min ${s} sec`
  return `${s} seconds`
}

function formatMs(ms: number | null): string {
  if (ms == null) return "--"
  return `${Math.round(ms)}ms`
}

const callTypeConfig: Record<CallType, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  incoming: { icon: ArrowDownLeft, label: "Incoming", color: "text-success", bgColor: "bg-success/10" },
  outgoing: { icon: ArrowUpRight, label: "Outgoing", color: "text-primary", bgColor: "bg-primary/10" },
  missed: { icon: PhoneMissed, label: "Missed", color: "text-destructive", bgColor: "bg-destructive/10" },
  voicemail: { icon: Voicemail, label: "Voicemail", color: "text-warning", bgColor: "bg-warning/10" },
}

function formatPhoneDisplay(phone: string | undefined | null): string {
  const v = String(phone || "")
  if (!v) return "Unknown"
  const digits = v.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return v
}

export function ActivityPage() {
  const [filter, setFilter] = useState<FilterType>("all")
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { calls, quality, insights, loading, loadError, refreshing } = useOperationsData()

  const filters: { id: FilterType; label: string }[] = [
    { id: "all", label: "All" },
    { id: "incoming", label: "Incoming" },
    { id: "outgoing", label: "Outgoing" },
    { id: "missed", label: "Missed" },
    { id: "voicemail", label: "Voicemail" },
  ]

  const filtered = useMemo(() => {
    return calls.filter((c: UiCallRecord) => {
      if (filter !== "all" && c.type !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          c.callerName.toLowerCase().includes(q) ||
          c.callerNumber.includes(q) ||
          c.routedTo.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [calls, filter, search])

  const totalCalls = calls.length
  const totalDuration = calls.reduce((sum, c) => sum + c.durationSeconds, 0)
  const recordingsCount = calls.filter((c) => c.hasRecording).length

  const grouped = useMemo(() => {
    const bucket: Record<string, CallRecord[]> = {}
    for (const call of filtered) {
      if (!bucket[call.date]) bucket[call.date] = []
      bucket[call.date].push(call)
    }
    return bucket
  }, [filtered])

  const answerRate = quality?.answer_rate_percent ?? 0
  const avgSetup = quality?.avg_setup_ms ?? null
  const p95Setup = quality?.p95_setup_ms ?? null
  const trend = insights?.daily_quality ?? []
  const numberQuality = insights?.number_quality ?? []
  const topMissedCallers = insights?.top_missed_callers ?? []
  const maxTrendSetup = Math.max(...trend.map((d) => d.avg_setup_ms ?? 0), 1)

  // True only before we have any rows or cached KPIs — avoids swapping the whole page for a pulsing skeleton.
  const awaitingFirstPayload = loading && calls.length === 0 && quality == null && insights == null && !loadError

  if (loadError && calls.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4 pb-8">
        <EmptyState
          title="Could not load activity"
          description="Please refresh to try again. If this continues, check your network and API credentials."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-8">
      {refreshing && (
        <div
          className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          <span>Refreshing activity…</span>
        </div>
      )}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Operations</h2>
        <p className="text-sm text-muted-foreground">Live quality KPIs and call activity</p>
      </div>

      {/* Core KPI Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <Phone className="mb-1 h-4 w-4 text-primary" />
          <span className="text-lg font-bold text-foreground">{awaitingFirstPayload ? "—" : totalCalls}</span>
          <span className="text-[10px] text-muted-foreground">Total Calls</span>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <Clock className="mb-1 h-4 w-4 text-warning" />
          <span className="text-lg font-bold text-foreground">
            {awaitingFirstPayload ? "—" : `${Math.floor(totalDuration / 60)}m`}
          </span>
          <span className="text-[10px] text-muted-foreground">Talk Time</span>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <Download className="mb-1 h-4 w-4 text-success" />
          <span className="text-lg font-bold text-foreground">{awaitingFirstPayload ? "—" : recordingsCount}</span>
          <span className="text-[10px] text-muted-foreground">Recordings</span>
        </div>
      </div>

      {/* Quality KPI Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <CheckCircle2 className="mb-1 h-4 w-4 text-success" />
          <span className="text-lg font-bold text-foreground">
            {awaitingFirstPayload ? "—" : `${answerRate.toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-muted-foreground">Answer Rate</span>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <Gauge className="mb-1 h-4 w-4 text-warning" />
          <span className="text-lg font-bold text-foreground">
            {avgSetup == null ? "--" : `${Math.round(avgSetup)}ms`}
          </span>
          <span className="text-[10px] text-muted-foreground">Avg Setup</span>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
          <Timer className="mb-1 h-4 w-4 text-primary" />
          <span className="text-lg font-bold text-foreground">
            {p95Setup == null ? "--" : `${Math.round(p95Setup)}ms`}
          </span>
          <span className="text-[10px] text-muted-foreground">P95 Setup</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search calls, contacts..."
          value={search}
          disabled={awaitingFirstPayload}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-2xl border border-border/70 bg-card/80 py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="tablist">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            disabled={awaitingFirstPayload}
            onClick={() => setFilter(f.id)}
            role="tab"
            aria-selected={filter === f.id}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "border border-border/70 bg-card text-muted-foreground hover:text-foreground",
              awaitingFirstPayload && "pointer-events-none opacity-50"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 7-Day Setup Trend */}
      <section className="sigo-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">7-day setup latency trend</p>
          <span className="text-xs text-muted-foreground">Goal: &lt; 1000ms</span>
        </div>
        {awaitingFirstPayload ? (
          <p className="text-xs text-muted-foreground">Loading trend data…</p>
        ) : trend.length === 0 ? (
          <p className="text-xs text-muted-foreground">No trend data yet.</p>
        ) : (
          <div className="flex items-end gap-1.5">
            {trend.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{d.avg_setup_ms == null ? "--" : Math.round(d.avg_setup_ms)}</span>
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${Math.max(6, ((d.avg_setup_ms ?? 0) / maxTrendSetup) * 60)}px` }}
                  title={`${d.day}: ${formatMs(d.avg_setup_ms)}`}
                />
                <span className="text-[10px] text-muted-foreground">
                  {new Date(`${d.day}T00:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Per-number quality */}
      <section className="sigo-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Per-number quality</p>
        {awaitingFirstPayload ? (
          <p className="text-xs text-muted-foreground">Loading per-number quality…</p>
        ) : numberQuality.length === 0 ? (
          <p className="text-xs text-muted-foreground">No per-number data yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {numberQuality.map((n) => (
              <div key={n.number} className="flex items-center justify-between rounded-xl bg-secondary/35 px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{formatPhoneDisplay(n.number)}</p>
                  <p className="text-[11px] text-muted-foreground">{n.total_calls} calls</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-foreground">{n.answer_rate_percent.toFixed(1)}% answer</p>
                  <p className="text-[11px] text-muted-foreground">{formatMs(n.avg_setup_ms)} avg setup</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top missed callers */}
      <section className="sigo-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Top missed callers</p>
        {awaitingFirstPayload ? (
          <p className="text-xs text-muted-foreground">Loading missed callers…</p>
        ) : topMissedCallers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No missed callers in selected window.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {topMissedCallers.map((m) => (
              <div key={m.caller_number} className="flex items-center justify-between rounded-xl bg-secondary/35 px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{formatPhoneDisplay(m.caller_number)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Last missed {new Date(m.last_missed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {m.missed_calls} missed
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Call Records by Date */}
      {awaitingFirstPayload && (
        <div className="rounded-xl border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
          Loading call list…
        </div>
      )}
      {loadError && calls.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {Object.entries(grouped).map(([date, calls]) => (
        <section key={date}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {date}
          </h3>
          <div className="flex flex-col gap-2">
            {calls.map((call) => {
              const config = callTypeConfig[call.type]
              const Icon = config.icon
              const isExpanded = expandedId === call.id

              return (
                <div key={call.id} className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : call.id)}
                    className="flex w-full items-center justify-between p-3.5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <IconSurface className={config.bgColor}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </IconSurface>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {call.callerName}
                        </p>
                        <p className="text-xs text-muted-foreground">{call.callerNumber}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
                      <span className="text-xs text-muted-foreground">{call.time}</span>
                      <div className="flex items-center gap-1.5">
                        {call.durationSeconds > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDuration(call.durationSeconds)}
                          </span>
                        )}
                        {call.hasRecording && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="border-t border-border px-3.5 pb-3.5 pt-3 flex flex-col gap-3">
                      {/* Details Row */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Routed To</span>
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className={cn(call.routedColor, "text-primary-foreground text-[8px] font-bold")}>
                                {call.routedInitials}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium text-foreground">{call.routedTo}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</span>
                          <span className="text-sm font-medium text-foreground">
                            {formatDurationLong(call.durationSeconds)}
                          </span>
                        </div>
                      </div>

                      {/* Recording Player */}
                      {call.hasRecording ? (
                        <div>
                          <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground">
                            Recording
                          </span>
                          {call.recordingUrl ? (
                            <a
                              href={call.recordingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2.5 text-xs text-foreground hover:bg-secondary"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Open recording
                            </a>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2.5">
                              <Voicemail className="h-4 w-4 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Recording not available yet</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2.5">
                          <Voicemail className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">No recording available</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {!awaitingFirstPayload && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12">
          <Filter className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No calls match your filters</p>
        </div>
      )}
    </div>
  )
}
