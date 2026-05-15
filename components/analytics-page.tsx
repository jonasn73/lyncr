"use client"

import { useState, useMemo, useEffect } from "react"
import {
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Phone,
  Pencil,
  Check,
  X,
  Settings2,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { useOperationsData, type UiCallRecord } from "@/lib/hooks/use-operations-data"

interface DailyBreakdown {
  day: string
  shortDay: string
  minutes: number
  calls: number
}

interface AgentWeekData {
  id: string
  name: string
  initials: string
  color: string
  rate: number
  weeklyMinutes: number
  weeklyCalls: number
  daily: DailyBreakdown[]
  previousWeekMinutes: number
}

function getWeekLabel(offset: number): string {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - now.getDay() + 1 + offset * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" })

  if (offset === 0) return `This Week (${fmt(start)} - ${fmt(end)})`
  if (offset === -1) return `Last Week (${fmt(start)} - ${fmt(end)})`
  return `${fmt(start)} - ${fmt(end)}`
}

const agentDataByWeek: Record<number, AgentWeekData[]> = {
  0: [
    {
      id: "1",
      name: "Sarah Miller",
      initials: "SM",
      color: "bg-primary",
      rate: 0.25,
      weeklyMinutes: 487,
      weeklyCalls: 62,
      previousWeekMinutes: 412,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 98, calls: 14 },
        { day: "Tuesday", shortDay: "Tue", minutes: 112, calls: 16 },
        { day: "Wednesday", shortDay: "Wed", minutes: 78, calls: 10 },
        { day: "Thursday", shortDay: "Thu", minutes: 95, calls: 12 },
        { day: "Friday", shortDay: "Fri", minutes: 104, calls: 10 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
    {
      id: "2",
      name: "James Wilson",
      initials: "JW",
      color: "bg-chart-2",
      rate: 0.25,
      weeklyMinutes: 213,
      weeklyCalls: 28,
      previousWeekMinutes: 245,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 42, calls: 6 },
        { day: "Tuesday", shortDay: "Tue", minutes: 55, calls: 7 },
        { day: "Wednesday", shortDay: "Wed", minutes: 38, calls: 5 },
        { day: "Thursday", shortDay: "Thu", minutes: 44, calls: 6 },
        { day: "Friday", shortDay: "Fri", minutes: 34, calls: 4 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
    {
      id: "3",
      name: "Rachel Kim",
      initials: "RK",
      color: "bg-chart-5",
      rate: 0.30,
      weeklyMinutes: 156,
      weeklyCalls: 19,
      previousWeekMinutes: 178,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 34, calls: 5 },
        { day: "Tuesday", shortDay: "Tue", minutes: 28, calls: 4 },
        { day: "Wednesday", shortDay: "Wed", minutes: 41, calls: 4 },
        { day: "Thursday", shortDay: "Thu", minutes: 32, calls: 3 },
        { day: "Friday", shortDay: "Fri", minutes: 21, calls: 3 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
  ],
  "-1": [
    {
      id: "1",
      name: "Sarah Miller",
      initials: "SM",
      color: "bg-primary",
      rate: 0.25,
      weeklyMinutes: 412,
      weeklyCalls: 53,
      previousWeekMinutes: 390,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 88, calls: 12 },
        { day: "Tuesday", shortDay: "Tue", minutes: 76, calls: 10 },
        { day: "Wednesday", shortDay: "Wed", minutes: 92, calls: 11 },
        { day: "Thursday", shortDay: "Thu", minutes: 84, calls: 10 },
        { day: "Friday", shortDay: "Fri", minutes: 72, calls: 10 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
    {
      id: "2",
      name: "James Wilson",
      initials: "JW",
      color: "bg-chart-2",
      rate: 0.25,
      weeklyMinutes: 245,
      weeklyCalls: 31,
      previousWeekMinutes: 220,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 52, calls: 7 },
        { day: "Tuesday", shortDay: "Tue", minutes: 48, calls: 6 },
        { day: "Wednesday", shortDay: "Wed", minutes: 56, calls: 7 },
        { day: "Thursday", shortDay: "Thu", minutes: 45, calls: 6 },
        { day: "Friday", shortDay: "Fri", minutes: 44, calls: 5 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
    {
      id: "3",
      name: "Rachel Kim",
      initials: "RK",
      color: "bg-chart-5",
      rate: 0.30,
      weeklyMinutes: 178,
      weeklyCalls: 22,
      previousWeekMinutes: 165,
      daily: [
        { day: "Monday", shortDay: "Mon", minutes: 38, calls: 5 },
        { day: "Tuesday", shortDay: "Tue", minutes: 42, calls: 5 },
        { day: "Wednesday", shortDay: "Wed", minutes: 35, calls: 4 },
        { day: "Thursday", shortDay: "Thu", minutes: 33, calls: 4 },
        { day: "Friday", shortDay: "Fri", minutes: 30, calls: 4 },
        { day: "Saturday", shortDay: "Sat", minutes: 0, calls: 0 },
        { day: "Sunday", shortDay: "Sun", minutes: 0, calls: 0 },
      ],
    },
  ],
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function AnalyticsPage() {
  const { calls: liveCalls, loading: liveCallsLoading } = useOperationsData()
  const liveTotalCalls = liveCalls.length
  const liveTotalMinutes = useMemo(
    () =>
      Math.floor(
        liveCalls.reduce((sum: number, c: UiCallRecord) => sum + (c.durationSeconds || 0), 0) / 60
      ),
    [liveCalls]
  )

  const [weekOffset, setWeekOffset] = useState(0)
  const [paySheetAgentId, setPaySheetAgentId] = useState<string | null>(null)
  const [editingRateId, setEditingRateId] = useState<string | null>(null)
  const [editRateValue, setEditRateValue] = useState("")
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({})
  const [showRateConfig, setShowRateConfig] = useState(false)

  const agents = (agentDataByWeek[weekOffset] || agentDataByWeek[0]).map((a) => ({
    ...a,
    rate: rateOverrides[a.id] ?? a.rate,
  }))

  const paySheetAgent = useMemo(
    () => (paySheetAgentId ? agents.find((a) => a.id === paySheetAgentId) ?? null : null),
    [paySheetAgentId, agents]
  )

  useEffect(() => {
    if (paySheetAgentId && !paySheetAgent) setPaySheetAgentId(null)
  }, [paySheetAgentId, paySheetAgent])

  const totalMinutes = agents.reduce((sum, a) => sum + a.weeklyMinutes, 0)
  const totalCalls = agents.reduce((sum, a) => sum + a.weeklyCalls, 0)
  const totalPayout = agents.reduce(
    (sum, a) => sum + a.weeklyMinutes * a.rate,
    0
  )
  const prevTotalMinutes = agents.reduce(
    (sum, a) => sum + a.previousWeekMinutes,
    0
  )
  const minutesTrend = prevTotalMinutes
    ? ((totalMinutes - prevTotalMinutes) / prevTotalMinutes) * 100
    : 0

  function startEditRate(agent: AgentWeekData) {
    setEditingRateId(agent.id)
    setEditRateValue((rateOverrides[agent.id] ?? agent.rate).toFixed(2))
  }

  function saveRate(agentId: string) {
    const val = parseFloat(editRateValue)
    if (!isNaN(val) && val >= 0) {
      setRateOverrides((prev) => ({ ...prev, [agentId]: val }))
    }
    setEditingRateId(null)
  }

  function cancelEditRate() {
    setEditingRateId(null)
  }

  const paySheetTrend =
    paySheetAgent && paySheetAgent.previousWeekMinutes
      ? ((paySheetAgent.weeklyMinutes - paySheetAgent.previousWeekMinutes) /
          paySheetAgent.previousWeekMinutes) *
        100
      : 0
  const paySheetMaxDaily = paySheetAgent
    ? Math.max(...paySheetAgent.daily.map((d) => d.minutes), 1)
    : 1

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      {/* Header */}
      <div className="sigo-section-header">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Pay</h2>
          <p className="text-sm text-muted-foreground">
            Track talk time and calculate payroll
          </p>
        </div>
        <button
          onClick={() => setShowRateConfig(!showRateConfig)}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
            showRateConfig
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          <Settings2 className="h-4 w-4" />
          Pay Rates
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-950 dark:text-amber-100">
        <p className="font-semibold text-foreground">Real calls vs sample payroll</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The three summary tiles below <span className="font-medium text-foreground">Account activity</span> use your
          live call log (same as Routing → Call Stats). The week picker, charts, and agent list are still{" "}
          <span className="font-medium text-foreground">demo sample data</span> until payroll is wired to receptionists.
        </p>
      </div>

      {/* Pay Rate Configuration Panel */}
      {showRateConfig && (
        <section className="sigo-card border-primary/20">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Configure Pay Rates</h3>
            <p className="text-xs text-muted-foreground">
              Set each agent{"'"}s per-minute rate. Earnings are calculated automatically.
            </p>
          </div>
          <div className="flex flex-col">
            {agents.map((agent, i) => {
              const isEditing = editingRateId === agent.id
              const isLast = i === agents.length - 1
              return (
                <div
                  key={agent.id}
                  className={cn(
                    "flex items-center justify-between px-4 py-3",
                    !isLast && "border-b border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className={cn(agent.color, "text-primary-foreground text-xs font-semibold")}>
                        {agent.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {agent.weeklyMinutes} min this week = {formatCurrency(agent.weeklyMinutes * agent.rate)}
                      </p>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editRateValue}
                        onChange={(e) => setEditRateValue(e.target.value)}
                        className="w-16 rounded-md border border-border bg-secondary px-2 py-1 text-right text-sm text-foreground outline-none focus:border-primary"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRate(agent.id)
                          if (e.key === "Escape") cancelEditRate()
                        }}
                      />
                      <span className="text-xs text-muted-foreground">/min</span>
                      <button
                        onClick={() => saveRate(agent.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                        aria-label="Save rate"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={cancelEditRate}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-muted-foreground hover:text-foreground"
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditRate(agent)}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <DollarSign className="h-3.5 w-3.5 text-primary" />
                      {agent.rate.toFixed(2)}/min
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Week Selector */}
      <div className="sigo-card flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setWeekOffset((w) => Math.max(w - 1, -1))}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-foreground">
          {getWeekLabel(weekOffset)}
        </span>
        <button
          onClick={() => setWeekOffset((w) => Math.min(w + 1, 0))}
          disabled={weekOffset >= 0}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
            weekOffset >= 0
              ? "text-muted-foreground/30"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Account summary — real rows from GET /api/calls (up to 100). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="sigo-card col-span-2 flex flex-col items-center gap-1 p-3.5 sm:col-span-1">
          <IconSurface tone="primary">
            <Clock className="h-5 w-5 text-primary" />
          </IconSurface>
          <p className="text-lg font-bold text-foreground leading-tight">
            {liveCallsLoading ? "…" : formatMinutes(liveTotalMinutes)}
          </p>
          <p className="text-[10px] text-muted-foreground">Account talk time</p>
        </div>
        <div className="sigo-card flex flex-col items-center gap-1 p-3.5">
          <IconSurface tone="success">
            <Phone className="h-5 w-5 text-success" />
          </IconSurface>
          <p className="text-lg font-bold text-foreground leading-tight">
            {liveCallsLoading ? "…" : liveTotalCalls}
          </p>
          <p className="text-[10px] text-muted-foreground">Calls in log</p>
        </div>
        <div className="sigo-card flex flex-col items-center gap-1 p-3.5">
          <IconSurface tone="warning">
            <DollarSign className="h-5 w-5 text-warning" />
          </IconSurface>
          <p className="text-lg font-bold text-foreground leading-tight">
            {formatCurrency(totalPayout)}
          </p>
          <p className="text-[10px] text-muted-foreground">Sample payout (demo)</p>
        </div>
      </div>

      {/* Trend */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2",
          minutesTrend >= 0 ? "bg-success/5" : "bg-destructive/5"
        )}
      >
        {minutesTrend >= 0 ? (
          <TrendingUp className="h-3.5 w-3.5 text-success" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5 text-destructive" />
        )}
        <span
          className={cn(
            "text-xs",
            minutesTrend >= 0 ? "text-success" : "text-destructive"
          )}
        >
          {minutesTrend >= 0 ? "+" : ""}
          {minutesTrend.toFixed(0)}% talk time vs previous week
        </span>
      </div>

      {/* Agent Breakdown */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Breakdown
        </h3>
        <div className="flex flex-col gap-3">
          {agents.map((agent) => {
            const earnings = agent.weeklyMinutes * agent.rate
            return (
              <div key={agent.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setPaySheetAgentId(agent.id)}
                  className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback
                        className={cn(
                          agent.color,
                          "text-primary-foreground text-xs font-semibold"
                        )}
                      >
                        {agent.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {agent.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {agent.weeklyCalls} calls
                        {" / "}
                        {formatMinutes(agent.weeklyMinutes)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-base font-bold text-foreground">
                      {formatCurrency(earnings)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      @ {formatCurrency(agent.rate)}/min
                    </span>
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <Sheet
        open={paySheetAgent != null}
        onOpenChange={(o) => {
          if (!o) {
            setPaySheetAgentId(null)
            cancelEditRate()
          }
        }}
        modal
      >
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {paySheetAgent ? (
            <>
              <StorySheetHeader
                eyebrow="Pay story"
                storyline="Same week you see on Pay — minutes, rate, and what they earned (sample data until payroll is wired)."
                title={paySheetAgent.name}
                description={
                  <>
                    {paySheetAgent.weeklyCalls} calls · {formatMinutes(paySheetAgent.weeklyMinutes)} on air ·{" "}
                    {formatCurrency(paySheetAgent.weeklyMinutes * paySheetAgent.rate)} estimated payout
                  </>
                }
              />
              <div className="max-h-[min(78dvh,640px)] space-y-0 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Per-minute rate
                  </span>
                  {editingRateId === paySheetAgent.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">
                        $
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editRateValue}
                        onChange={(e) => setEditRateValue(e.target.value)}
                        className="w-16 rounded-md border border-border bg-secondary px-2 py-1 text-right text-sm text-foreground outline-none focus:border-primary"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRate(paySheetAgent.id)
                          if (e.key === "Escape") cancelEditRate()
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => saveRate(paySheetAgent.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                        aria-label="Save rate"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditRate}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditRate(paySheetAgent)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      {formatCurrency(paySheetAgent.rate)}/min
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-px bg-border">
                  <div className="flex flex-col items-center bg-card px-3 py-3">
                    <span className="text-xs text-muted-foreground">
                      Minutes
                    </span>
                    <span className="text-sm font-bold text-foreground">
                      {paySheetAgent.weeklyMinutes}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-card px-3 py-3">
                    <span className="text-xs text-muted-foreground">
                      Rate
                    </span>
                    <span className="text-sm font-bold text-foreground">
                      {formatCurrency(paySheetAgent.rate)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-card px-3 py-3">
                    <span className="text-xs text-muted-foreground">
                      Earned
                    </span>
                    <span className="text-sm font-bold text-primary">
                      {formatCurrency(paySheetAgent.weeklyMinutes * paySheetAgent.rate)}
                    </span>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">
                    Daily breakdown
                  </p>
                  <div className="flex items-end justify-between gap-1.5">
                    {paySheetAgent.daily.map((day) => (
                      <div
                        key={day.shortDay}
                        className="flex flex-1 flex-col items-center gap-1.5"
                      >
                        <span className="text-[10px] font-medium text-foreground">
                          {day.minutes > 0 ? `${day.minutes}m` : ""}
                        </span>
                        <div
                          className={cn(
                            "w-full rounded-t-md transition-all",
                            day.minutes > 0
                              ? paySheetAgent.color + " opacity-70"
                              : "bg-secondary"
                          )}
                          style={{
                            height: `${Math.max(
                              (day.minutes / paySheetMaxDaily) * 80,
                              4
                            )}px`,
                          }}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {day.shortDay}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border px-4 py-3">
                  <div
                    className={cn(
                      "flex items-center gap-1.5",
                      paySheetTrend >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    {paySheetTrend >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    <span className="text-xs">
                      {paySheetTrend >= 0 ? "+" : ""}
                      {paySheetTrend.toFixed(0)}% vs previous week (
                      {formatMinutes(paySheetAgent.previousWeekMinutes)})
                    </span>
                  </div>
                </div>
              </div>
              <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                <p className="text-[11px] text-muted-foreground">
                  Live account talk time is on this page above; agent rows stay sample until API-backed payroll ships.
                </p>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Payout Summary */}
      <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <h3 className="mb-3 text-sm font-semibold text-primary">
          Weekly Payout Summary
        </h3>
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-foreground">{agent.name}</span>
              <span className="font-mono font-medium text-foreground">
                {formatMinutes(agent.weeklyMinutes)} ={" "}
                <span className="text-primary">
                  {formatCurrency(agent.weeklyMinutes * agent.rate)}
                </span>
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-primary/20 pt-2 text-sm">
            <span className="font-semibold text-foreground">Total</span>
            <span className="font-mono text-lg font-bold text-primary">
              {formatCurrency(totalPayout)}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
