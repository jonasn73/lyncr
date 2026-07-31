"use client"

import { memo, useCallback, useState } from "react"
import Link from "next/link"
import { ChevronRight, Percent, Phone, PhoneIncoming, PhoneMissed, Timer, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
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
import { DASHBOARD_MOBILE_PAGE_HREF, DASHBOARD_PAGE_HREF } from "@/lib/dashboard-nav"
import { LINES_MOBILE_CARD } from "@/lib/mobile-shell"

/** Full call log — same deep link the Activity mobile tab uses. */
const ALL_CALLS_HREF =
  DASHBOARD_MOBILE_PAGE_HREF.activity ?? `${DASHBOARD_PAGE_HREF.activity}?filter=all`

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
      {/* Always reserve the sublabel line so “4 leads” appearing doesn’t resize the grid. */}
      <span
        className={cn(
          "max-w-full min-h-[0.875rem] text-center text-[9px] font-medium leading-tight",
          sublabel ? "text-amber-400/90" : "invisible"
        )}
      >
        {sublabel || "·"}
      </span>
    </>
  )
  const shared =
    "flex min-h-[3.75rem] min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5"
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
  const {
    dailyCalls,
    missedCalls,
    liveLineCount,
    bookingRatePercent,
    avgDispatchSpeedMinutes,
    rescueRevenueCents,
    baselineReady,
  } = useRealTimeStatsContext()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")
  const [rescueOpen, setRescueOpen] = useState(false)

  const bookingEmpty = isBookingRateEmpty(bookingRatePercent)
  const bookingDisplay = baselineReady ? formatBookingRatePercent(bookingRatePercent) : "—"
  const speedDisplay = baselineReady ? formatAvgDispatchSpeedMinutes(avgDispatchSpeedMinutes) : "—"
  // Never flash $0 for Rescue before cache/API settles — show em dash instead.
  const rescueDisplay = formatRescueRevenueDollars(baselineReady ? rescueRevenueCents : null)
  const rescueHot = baselineReady && rescueRevenueCents > 0
  const callsDisplay = baselineReady ? dailyCalls : "—"
  const missedDisplay = baselineReady ? missedCalls : "—"
  const linesDisplay = baselineReady ? liveLineCount : "—"

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

  // CSS breakpoints (not useIsMobile) so SSR + first paint match — no desktop→mobile collapse on refresh.
  return (
    <>
      <section
        className={cn("w-full space-y-2 py-0 md:hidden", className)}
        aria-label="Dispatch performance"
      >
        <div className={cn(LINES_MOBILE_CARD, "grid grid-cols-3 gap-1 p-2")}>
          <TelemetryTickerItem label="Live" value={linesDisplay} />
          <TelemetryTickerItem
            label="Calls"
            value={callsDisplay}
            onClick={() => openCallHistory("daily")}
          />
          <TelemetryTickerItem
            label={missedTickerLabel}
            value={missedDisplay}
            sublabel={baselineReady ? missedTickerSublabel : null}
            valueClassName={baselineReady && missedCalls > 0 ? "text-amber-300" : undefined}
            labelClassName={missedLeadCollapse ? "text-amber-400/90" : undefined}
            onClick={openMissedRescue}
          />
          <TelemetryTickerItem
            label="Booking"
            value={bookingDisplay}
            valueClassName={bookingEmpty || !baselineReady ? "text-sm font-medium text-zinc-400" : undefined}
          />
          <TelemetryTickerItem label="Dispatch" value={speedDisplay} />
          <TelemetryTickerItem
            label="Rescue"
            value={rescueDisplay}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </div>
        {/* Deep-link to the full Activity call log (missed callbacks + history). */}
        <Link
          href={ALL_CALLS_HREF}
          prefetch
          scroll={false}
          className={cn(
            LINES_MOBILE_CARD,
            "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5",
            "text-sm font-semibold text-foreground touch-manipulation",
            "transition-colors hover:bg-zinc-900/60 active:scale-[0.99]"
          )}
        >
          <span className="inline-flex items-center gap-2">
            <PhoneIncoming className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            All calls
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        </Link>
      </section>
      <section
        className={cn("hidden w-full space-y-2 md:block", className)}
        aria-label="Workspace telemetry"
      >
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-4 py-3 backdrop-blur-md">
          <TelemetryPill label="Live lines" value={linesDisplay} icon={Phone} tone="teal" />
          <TelemetryPill
            label="Daily calls"
            value={callsDisplay}
            icon={PhoneIncoming}
            onClick={() => openCallHistory("daily")}
          />
          <TelemetryPill
            label={missedDesktopLabel}
            value={missedDisplay}
            icon={PhoneMissed}
            tone={baselineReady && missedCalls > 0 ? "amber" : "default"}
            valueClassName={baselineReady && missedCalls > 0 ? "text-amber-400" : undefined}
            labelClassName={missedLeadCollapse ? "text-amber-400 font-semibold" : undefined}
            onClick={openMissedRescue}
          />
          <TelemetryPill
            label="Booking rate"
            value={bookingDisplay}
            icon={Percent}
            tone="teal"
            valueClassName={bookingEmpty || !baselineReady ? "text-sm font-medium text-slate-400" : undefined}
          />
          <TelemetryPill label="Avg dispatch" value={speedDisplay} icon={Timer} tone="teal" />
          <TelemetryPill
            label="Rescue revenue"
            value={rescueDisplay}
            icon={DollarSign}
            tone={rescueHot ? "amber" : "emerald"}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </div>
        <Link
          href={ALL_CALLS_HREF}
          prefetch
          scroll={false}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 py-1.5",
            "text-xs font-semibold text-primary hover:underline"
          )}
        >
          All calls
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>

      {/* Lazy-mount dialogs — closed Radix roots still ran effects/close buttons
          on every Lines paint and fed the #185 update-depth loop. */}
      {historyOpen ? (
        <RoutingCallHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          filter={historyFilter}
          businessNumbers={businessNumbers}
        />
      ) : null}
      {rescueOpen ? (
        <MissedCallRescueSheet
          open={rescueOpen}
          onOpenChange={setRescueOpen}
          businessNumbers={businessNumbers}
        />
      ) : null}
    </>
  )
})
