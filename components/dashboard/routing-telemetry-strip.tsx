"use client"

import { memo, useCallback, useState } from "react"
import { CalendarDays, CalendarRange, Clock, Phone, PhoneIncoming, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { WORKSPACE_MOBILE_BLEED } from "@/components/dashboard-workspace-ui"
import { formatTalkDuration, formatTalkTime } from "@/lib/daily-call-telemetry"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import {
  RoutingCallHistoryDialog,
  type CallHistoryFilter,
} from "@/components/dashboard/routing-call-history-dialog"
import { useRealTimeStatsContext } from "@/components/dashboard/real-time-stats-provider"

const MOBILE_DURATION_VALUE = "text-[15px] font-bold tabular-nums leading-none sm:text-base"

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal"
  valueClassName?: string
  /** When set, the pill becomes a clickable button that opens call history. */
  onClick?: () => void
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  onClick,
}: TelemetryPillProps) {
  const sharedClasses = cn(
    "inline-flex min-w-[10.5rem] shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 md:min-w-0",
    "bg-neutral-950/50 backdrop-blur-sm transition-all duration-200",
    tone === "amber" && "border-amber-500/25 text-amber-100/90",
    tone === "teal" && "border-teal-500/25 text-teal-100/90",
    tone === "default" && "border-white/8 text-foreground/90",
    onClick && "cursor-pointer hover:bg-zinc-900/50"
  )

  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm font-bold tabular-nums text-foreground", valueClassName)}>{value}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          sharedClasses,
          "relative z-10 min-h-11 touch-manipulation",
          "hover:border-cyan-500/30 hover:bg-zinc-900/70 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
        )}
        aria-label={`${label}: ${value}. Open call history.`}
      >
        {inner}
      </button>
    )
  }

  return <div className={sharedClasses}>{inner}</div>
}

function TelemetryTile({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  onClick,
  className,
}: TelemetryPillProps & { className?: string }) {
  const shared = cn(
    "flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
    "min-h-[4.25rem] touch-manipulation active:scale-[0.98]",
    tone === "amber" && "border-amber-500/20 bg-amber-500/5",
    tone === "teal" && "border-teal-500/20 bg-teal-500/5",
    tone === "default" && "border-border/40 bg-zinc-950/50",
    onClick && "cursor-pointer hover:bg-zinc-900/60",
    className
  )
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-lg font-bold tabular-nums leading-none text-foreground", valueClassName)}>{value}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared} aria-label={`${label}: ${value}`}>
        {body}
      </button>
    )
  }
  return <div className={shared}>{body}</div>
}

export const RoutingTelemetryStrip = memo(function RoutingTelemetryStrip({
  businessNumbers: _businessNumbers,
  className,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
}) {
  const isMobile = useIsMobile()
  const {
    dailyCalls,
    missedCalls,
    liveDailyTalkSeconds,
    liveWeeklyTalkSeconds,
    liveMonthlyTalkSeconds,
    liveLineCount,
  } = useRealTimeStatsContext()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")

  const dailyTalkDisplay = formatTalkTime(liveDailyTalkSeconds)
  const weeklyTalkDisplay = formatTalkDuration(liveWeeklyTalkSeconds)
  const monthlyTalkDisplay = formatTalkDuration(liveMonthlyTalkSeconds)

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  return (
    <>
      <section
        className={cn(
          isMobile
            ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
            : "flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-3 py-2 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] sm:px-4 md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden",
          !isMobile && WORKSPACE_MOBILE_BLEED,
          className
        )}
        aria-label="Workspace telemetry"
      >
        {isMobile ? (
          <>
            <TelemetryTile label="Live lines" value={liveLineCount} icon={Phone} tone="teal" />
            <TelemetryTile
              label="Calls today"
              value={dailyCalls}
              icon={PhoneIncoming}
              onClick={() => openCallHistory("daily")}
            />
            <TelemetryTile
              label="Missed today"
              value={missedCalls}
              icon={PhoneMissed}
              tone={missedCalls > 0 ? "amber" : "default"}
              valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
              onClick={() => openCallHistory("missed")}
            />
            <TelemetryTile
              label="Talk today"
              value={dailyTalkDisplay}
              icon={Clock}
              tone="teal"
              onClick={() => openCallHistory("daily_talk")}
            />
            <TelemetryTile
              label="Talk week"
              value={weeklyTalkDisplay}
              icon={CalendarRange}
              tone="teal"
              valueClassName={MOBILE_DURATION_VALUE}
              onClick={() => openCallHistory("weekly_talk")}
            />
            <TelemetryTile
              label="Talk month"
              value={monthlyTalkDisplay}
              icon={CalendarDays}
              tone="teal"
              valueClassName={MOBILE_DURATION_VALUE}
              onClick={() => openCallHistory("monthly_talk")}
            />
          </>
        ) : (
          <>
            <TelemetryPill label="Live lines" value={liveLineCount} icon={Phone} tone="teal" />
            <TelemetryPill
              label="Daily calls"
              value={dailyCalls}
              icon={PhoneIncoming}
              onClick={() => openCallHistory("daily")}
            />
            <TelemetryPill
              label="Missed calls"
              value={missedCalls}
              icon={PhoneMissed}
              tone={missedCalls > 0 ? "amber" : "default"}
              valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
              onClick={() => openCallHistory("missed")}
            />
            <TelemetryPill
              label="Daily talk"
              value={dailyTalkDisplay}
              icon={Clock}
              tone="teal"
              onClick={() => openCallHistory("daily_talk")}
            />
            <TelemetryPill
              label="Weekly talk"
              value={weeklyTalkDisplay}
              icon={CalendarRange}
              tone="teal"
              onClick={() => openCallHistory("weekly_talk")}
            />
            <TelemetryPill
              label="Monthly talk"
              value={monthlyTalkDisplay}
              icon={CalendarDays}
              tone="teal"
              onClick={() => openCallHistory("monthly_talk")}
            />
          </>
        )}
      </section>

      <RoutingCallHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        filter={historyFilter}
        businessNumbers={_businessNumbers}
        expectedTalkSeconds={
          historyFilter === "daily_talk"
            ? liveDailyTalkSeconds
            : historyFilter === "weekly_talk"
              ? liveWeeklyTalkSeconds
              : historyFilter === "monthly_talk"
                ? liveMonthlyTalkSeconds
                : undefined
        }
      />
    </>
  )
})
