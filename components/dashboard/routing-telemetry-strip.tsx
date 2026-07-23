"use client"

import { memo, useCallback, useState } from "react"
import { Percent, Phone, PhoneIncoming, PhoneMissed, Timer, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
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
import {
  formatMissedTickerLabel,
  formatMissedTickerSublabel,
} from "@/lib/missed-lead-aggregation"
import { LINES_MOBILE_CARD } from "@/lib/mobile-shell"

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal" | "emerald"
  valueClassName?: string
  labelClassName?: string
  onClick?: () => void
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  labelClassName,
  onClick,
}: TelemetryPillProps) {
  const sharedClasses = cn(
    "inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-full border px-2.5 py-1.5",
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
      <span
        className={cn(
          "truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
          labelClassName
        )}
      >
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

/** Metric cell — bold value over tiny uppercase label; fills its grid track. */
function TelemetryTickerItem({
  label,
  value,
  sublabel,
  valueClassName,
  labelClassName,
  onClick,
}: {
  label: string
  value: string | number
  /** Optional second line (e.g. "5 leads") — keeps the main label short on mobile. */
  sublabel?: string | null
  valueClassName?: string
  labelClassName?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <span className={cn("text-base font-bold tabular-nums text-slate-100", valueClassName)}>
        {value}
      </span>
      <span
        className={cn(
          "max-w-full text-center text-[9px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]",
          labelClassName
        )}
      >
        {label}
      </span>
      {sublabel ? (
        <span className="max-w-full text-center text-[9px] font-medium leading-tight text-amber-400/90">
          {sublabel}
        </span>
      ) : null}
    </>
  )
  const shared =
    "flex min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5"
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(shared, "cursor-pointer touch-manipulation transition-all active:scale-95")}
        aria-label={sublabel ? `${label}: ${value} (${sublabel})` : `${label}: ${value}`}
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
  uniqueMissedLeads,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
  /** Unique phones among today's misses — when lower than missedCalls, ticker shows LEADS. */
  uniqueMissedLeads?: number
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

  // Prefer live ticker total; fall back to unique only when stats have not caught up.
  const uniqueLeads =
    typeof uniqueMissedLeads === "number" && uniqueMissedLeads >= 0
      ? uniqueMissedLeads
      : missedCalls
  const missedLeadCollapse = uniqueLeads > 0 && uniqueLeads < missedCalls
  const missedTickerLabel = formatMissedTickerLabel(missedCalls, uniqueLeads)
  const missedTickerSublabel = formatMissedTickerSublabel(missedCalls, uniqueLeads)
  const missedDesktopLabel = missedLeadCollapse
    ? `${missedCalls} missed (${uniqueLeads} leads)`
    : "Missed calls"

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  // Open the Missed Call Rescue drawer (Calls · Leads hotlist).
  const openMissedRescue = useCallback(() => {
    setRescueOpen(true)
  }, [])

  return (
    <>
      {isMobile ? (
        <section
          className={cn("w-full py-0", className)}
          aria-label="Dispatch performance"
        >
          <div className={cn(LINES_MOBILE_CARD, "grid grid-cols-3 gap-1 p-2")}>
            <TelemetryTickerItem label="Live" value={liveLineCount} />
            <TelemetryTickerItem
              label="Calls"
              value={dailyCalls}
              onClick={() => openCallHistory("daily")}
            />
            <TelemetryTickerItem
              label={missedTickerLabel}
              value={missedCalls}
              sublabel={missedTickerSublabel}
              valueClassName={missedCalls > 0 ? "text-amber-300" : undefined}
              labelClassName={missedLeadCollapse ? "text-amber-400/90" : undefined}
              onClick={openMissedRescue}
            />
            <TelemetryTickerItem
              label="Booking"
              value={bookingDisplay}
              valueClassName={bookingEmpty ? "text-sm font-medium text-zinc-400" : undefined}
            />
            <TelemetryTickerItem label="Dispatch" value={speedDisplay} />
            <TelemetryTickerItem
              label="Rescue"
              value={rescueDisplay}
              valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
            />
          </div>
        </section>
      ) : (
        <section
          className={cn(
            "grid grid-cols-3 gap-2 w-full rounded-2xl border border-white/5 bg-neutral-950/40 px-4 py-3 backdrop-blur-md",
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
            label={missedDesktopLabel}
            value={missedCalls}
            icon={PhoneMissed}
            tone={missedCalls > 0 ? "amber" : "default"}
            valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
            labelClassName={missedLeadCollapse ? "text-amber-400 font-semibold" : undefined}
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
