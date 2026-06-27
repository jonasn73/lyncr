"use client"

import { memo, useCallback, useState } from "react"
import { CalendarRange, Clock, Phone, PhoneIncoming, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
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

export const RoutingTelemetryStrip = memo(function RoutingTelemetryStrip({
  businessNumbers: _businessNumbers,
  className,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
}) {
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

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  return (
    <>
      <section
        className={cn(
          "flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-3 py-2 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] sm:px-4 md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden",
          WORKSPACE_MOBILE_BLEED,
          className
        )}
        aria-label="Workspace telemetry"
      >
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
