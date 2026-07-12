"use client"

import { memo, useCallback, useState } from "react"
import { Percent, Phone, PhoneIncoming, PhoneMissed, Timer, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { WORKSPACE_MOBILE_BLEED } from "@/components/dashboard-workspace-ui"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import {
  RoutingCallHistoryDialog,
  type CallHistoryFilter,
} from "@/components/dashboard/routing-call-history-dialog"
import { MissedCallRescueSheet } from "@/components/dashboard/missed-call-rescue-sheet"
import { useRealTimeStatsContext } from "@/components/dashboard/real-time-stats-provider"
import {
  formatAvgDispatchSpeedMinutes,
  formatBookingRatePercent,
  formatRescueRevenueDollars,
  isBookingRateEmpty,
} from "@/lib/dispatch-performance-formatters"

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal" | "emerald"
  valueClassName?: string
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
    tone === "emerald" && "border-emerald-500/25 text-emerald-100/90",
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
          "hover:border-cyan-500/30 hover:bg-zinc-900/70 active:scale-95 transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
        )}
        aria-label={`${label}: ${value}. Open details.`}
      >
        {inner}
      </button>
    )
  }

  return <div className={sharedClasses}>{inner}</div>
}

/** Mobile ticker cell — bold value over tiny uppercase label, no card chrome. */
function TelemetryTickerItem({
  label,
  value,
  valueClassName,
  onClick,
}: {
  label: string
  value: string | number
  valueClassName?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <span className={cn("text-base font-bold tabular-nums text-slate-100", valueClassName)}>{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
    </>
  )
  const shared = "inline-flex min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5"
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          shared,
          "cursor-pointer touch-manipulation transition-all active:scale-95"
        )}
        aria-label={`${label}: ${value}`}
      >
        {body}
      </button>
    )
  }
  return <div className={shared}>{body}</div>
}

export const RoutingTelemetryStrip = memo(function RoutingTelemetryStrip({
  businessNumbers,
  className,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
}) {
  const isMobile = useIsMobile()
  const {
    dailyCalls,
    missedCalls,
    liveLineCount,
    bookingRatePercent,
    avgDispatchSpeedMinutes,
    rescueRevenueCents,
  } = useRealTimeStatsContext()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")
  const [rescueOpen, setRescueOpen] = useState(false)

  const bookingEmpty = isBookingRateEmpty(bookingRatePercent)
  const bookingDisplay = formatBookingRatePercent(bookingRatePercent)
  const speedDisplay = formatAvgDispatchSpeedMinutes(avgDispatchSpeedMinutes)
  const rescueDisplay = formatRescueRevenueDollars(rescueRevenueCents)
  const rescueHot = rescueRevenueCents > 0

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  const openMissedRescue = useCallback(() => {
    setRescueOpen(true)
  }, [])

  return (
    <>
      {isMobile ? (
        <section
          className={cn(
            "flex flex-row items-center justify-between gap-4 overflow-x-auto border-b border-slate-900 bg-slate-950/40 px-2 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            className
          )}
          aria-label="Dispatch performance"
        >
          <TelemetryTickerItem label="Live" value={liveLineCount} />
          <TelemetryTickerItem
            label="Calls"
            value={dailyCalls}
            onClick={() => openCallHistory("daily")}
          />
          <TelemetryTickerItem
            label="Missed"
            value={missedCalls}
            valueClassName={missedCalls > 0 ? "text-amber-300" : undefined}
            onClick={openMissedRescue}
          />
          <TelemetryTickerItem
            label="Booking"
            value={bookingDisplay}
            valueClassName={bookingEmpty ? "text-sm font-medium text-slate-400" : undefined}
          />
          <TelemetryTickerItem label="Dispatch" value={speedDisplay} />
          <TelemetryTickerItem
            label="Rescue"
            value={rescueDisplay}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </section>
      ) : (
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
            onClick={openMissedRescue}
          />
          <TelemetryPill
            label="Booking rate"
            value={bookingDisplay}
            icon={Percent}
            tone="teal"
            valueClassName={bookingEmpty ? "text-sm font-medium text-slate-400" : undefined}
          />
          <TelemetryPill label="Avg dispatch" value={speedDisplay} icon={Timer} tone="teal" />
          <TelemetryPill
            label="Rescue revenue"
            value={rescueDisplay}
            icon={DollarSign}
            tone={rescueHot ? "amber" : "emerald"}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </section>
      )}

      <RoutingCallHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        filter={historyFilter}
        businessNumbers={businessNumbers}
      />
      <MissedCallRescueSheet
        open={rescueOpen}
        onOpenChange={setRescueOpen}
        businessNumbers={businessNumbers}
      />
    </>
  )
})
