"use client"

import { memo, useCallback, useState } from "react"
import { CalendarRange, Clock, Phone, PhoneIncoming, PhoneMissed } from "lucide-react"
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

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal" | "success"
  valueClassName?: string
  /** Shown instead of 0 / 0:00 — keeps empty tiles from feeling broken. */
  emptyLabel?: string
  isEmpty?: boolean
  /** When set, the pill becomes a clickable button that opens call history. */
  onClick?: () => void
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  emptyLabel,
  isEmpty = false,
  onClick,
}: TelemetryPillProps) {
  const sharedClasses = cn(
    "inline-flex min-w-[10.5rem] shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 md:min-w-0",
    "bg-neutral-950/50 backdrop-blur-sm transition-all duration-200",
    tone === "amber" && "border-amber-500/25 text-amber-100/90",
    tone === "teal" && "border-teal-500/25 text-teal-100/90",
    tone === "success" && "border-emerald-500/20 text-emerald-100/90",
    tone === "default" && "border-white/8 text-foreground/90",
    onClick && "cursor-pointer hover:bg-zinc-900/50"
  )

  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          isEmpty
            ? "text-xs font-medium text-zinc-500"
            : cn("text-sm font-bold text-foreground", valueClassName)
        )}
      >
        {isEmpty && emptyLabel ? emptyLabel : value}
      </span>
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
  emptyLabel,
  isEmpty = false,
  onClick,
  className,
}: TelemetryPillProps & { className?: string }) {
  const shared = cn(
    "flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
    "min-h-[4.25rem] touch-manipulation active:scale-[0.98]",
    isEmpty && "border-border/25 bg-zinc-950/30",
    !isEmpty && tone === "amber" && "border-amber-500/20 bg-amber-500/5",
    !isEmpty && tone === "teal" && "border-teal-500/20 bg-teal-500/5",
    !isEmpty && tone === "success" && "border-emerald-500/20 bg-emerald-500/5",
    !isEmpty && tone === "default" && "border-border/40 bg-zinc-950/50",
    onClick && "cursor-pointer hover:bg-zinc-900/60",
    className
  )
  const display = isEmpty && emptyLabel ? emptyLabel : value
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isEmpty ? "text-zinc-600" : "text-muted-foreground"
          )}
          aria-hidden
        />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <span
        className={cn(
          "leading-snug tabular-nums",
          isEmpty
            ? "text-sm font-medium text-zinc-500"
            : cn("text-lg font-bold leading-none text-foreground", valueClassName)
        )}
      >
        {display}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={shared}
        aria-label={`${label}: ${isEmpty && emptyLabel ? emptyLabel : value}`}
      >
        {body}
      </button>
    )
  }
  return <div className={shared}>{body}</div>
}

function isZeroTalkDisplay(display: string): boolean {
  const normalized = display.trim()
  return normalized === "0:00" || normalized === "0:0" || normalized === "0:00:00" || normalized === "0:0:0"
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
    dailyTalkSeconds,
    weeklyTalkSeconds,
    liveLineCount,
  } = useRealTimeStatsContext()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")

  const dailyTalkDisplay = formatTalkTime(dailyTalkSeconds)
  const weeklyTalkDisplay = formatTalkDuration(weeklyTalkSeconds)
  const callsEmpty = dailyCalls === 0
  const missedEmpty = missedCalls === 0
  const dailyTalkEmpty = dailyTalkSeconds === 0 || isZeroTalkDisplay(dailyTalkDisplay)
  const weeklyTalkEmpty = weeklyTalkSeconds === 0 || isZeroTalkDisplay(weeklyTalkDisplay)

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  return (
    <>
      <section
        className={cn(
          isMobile
            ? "grid grid-cols-2 gap-2"
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
              isEmpty={callsEmpty}
              emptyLabel="Quiet so far"
              onClick={() => openCallHistory("daily")}
            />
            <TelemetryTile
              label="Missed today"
              value={missedCalls}
              icon={PhoneMissed}
              isEmpty={missedEmpty}
              emptyLabel="All clear"
              tone={missedEmpty ? "success" : "amber"}
              valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
              onClick={() => openCallHistory("missed")}
            />
            <TelemetryTile
              label="Talk today"
              value={dailyTalkDisplay}
              icon={Clock}
              isEmpty={dailyTalkEmpty}
              emptyLabel="No talk yet"
              tone="teal"
              onClick={() => openCallHistory("daily_talk")}
            />
            <TelemetryTile
              label="Talk week"
              value={weeklyTalkDisplay}
              icon={CalendarRange}
              isEmpty={weeklyTalkEmpty}
              emptyLabel="No talk this week"
              tone="teal"
              onClick={() => openCallHistory("weekly_talk")}
              className="col-span-2"
            />
          </>
        ) : (
          <>
            <TelemetryPill label="Live lines" value={liveLineCount} icon={Phone} tone="teal" />
            <TelemetryPill
              label="Daily calls"
              value={dailyCalls}
              icon={PhoneIncoming}
              isEmpty={callsEmpty}
              emptyLabel="Quiet so far"
              onClick={() => openCallHistory("daily")}
            />
            <TelemetryPill
              label="Missed calls"
              value={missedCalls}
              icon={PhoneMissed}
              isEmpty={missedEmpty}
              emptyLabel="All clear"
              tone={missedEmpty ? "success" : "amber"}
              valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
              onClick={() => openCallHistory("missed")}
            />
            <TelemetryPill
              label="Daily talk"
              value={dailyTalkDisplay}
              icon={Clock}
              isEmpty={dailyTalkEmpty}
              emptyLabel="No talk yet"
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
            ? dailyTalkSeconds
            : historyFilter === "weekly_talk"
              ? weeklyTalkSeconds
              : undefined
        }
      />
    </>
  )
})
