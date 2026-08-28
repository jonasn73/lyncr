"use client"

import { memo, useCallback, useState } from "react"
import { Percent, Phone, PhoneIncoming, PhoneMissed, Timer, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAnimatedNumber } from "@/lib/hooks/use-animated-number"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import {
  RoutingCallHistoryDialog,
  type CallHistoryFilter,
} from "@/components/dashboard/routing-call-history-dialog"
import { MissedCallRescueSheet } from "@/components/dashboard/missed-call-rescue-sheet"
import { useRealTimeStatsContext } from "@/components/dashboard/real-time-stats-provider"
import {
  formatAvgDispatchSpeedMinutes,
  formatBookingJobsFraction,
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
  /** When set (a real number, baseline ready), the value rolls toward it instead of a hard text swap. */
  animatedValue?: number | null
  /** Formats the rolling number — defaults to a plain rounded integer. */
  animatedFormatter?: (n: number) => string
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  labelClassName,
  onClick,
  animatedValue = null,
  animatedFormatter,
}: TelemetryPillProps) {
  const rolled = useAnimatedNumber(animatedValue ?? 0, { formatter: animatedFormatter })
  const displayValue = animatedValue != null ? rolled : value
  const sharedClasses = cn(
    "inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-full border px-3 py-2",
    "bg-neutral-950/50 backdrop-blur-sm transition-all duration-200",
    tone === "amber" && "border-amber-500/25 text-amber-100/90",
    tone === "teal" && "border-teal-500/25 text-teal-100/90",
    tone === "emerald" && "border-emerald-500/25 text-emerald-100/90",
    tone === "default" && "border-white/8 text-foreground/90",
    onClick && "cursor-pointer hover:bg-card/50"
  )

  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span
        className={cn(
          "truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground",
          labelClassName
        )}
      >
        {label}
      </span>
      <span className={cn("text-sm font-bold tabular-nums text-foreground", valueClassName)}>
        {displayValue}
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
          "hover:border-cyan-500/30 hover:bg-card/70 active:scale-95 transition-all",
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
  sublabelClassName,
  onClick,
  animatedValue = null,
  animatedFormatter,
}: {
  label: string
  value: string | number
  /** Optional second line (e.g. "5 leads") — keeps the main label short on mobile. */
  sublabel?: string | null
  valueClassName?: string
  labelClassName?: string
  /** Override default amber sublabel (e.g. booking fraction 1/18). */
  sublabelClassName?: string
  onClick?: () => void
  /** When set (a real number, baseline ready), the value rolls toward it instead of a hard text swap. */
  animatedValue?: number | null
  /** Formats the rolling number — defaults to a plain rounded integer. */
  animatedFormatter?: (n: number) => string
}) {
  const rolled = useAnimatedNumber(animatedValue ?? 0, { formatter: animatedFormatter })
  const displayValue = animatedValue != null ? rolled : value
  const body = (
    <>
      {/* Slightly smaller than before so the 3×2 block reads shorter on phones. */}
      <span className={cn("text-sm font-bold leading-none tabular-nums text-foreground", valueClassName)}>
        {displayValue}
      </span>
      <span
        className={cn(
          "max-w-full text-center text-micro font-semibold uppercase leading-none tracking-wider text-muted-foreground",
          labelClassName
        )}
      >
        {label}
      </span>
      {/* Always reserve third line so Missed/Booked sublabels do not grow cells after settle. */}
      <span
        className={cn(
          "max-w-full truncate text-center text-micro font-medium leading-none",
          sublabel ? "text-amber-400/90" : "invisible text-transparent",
          sublabelClassName
        )}
        aria-hidden={!sublabel}
      >
        {sublabel || "—"}
      </span>
    </>
  )
  // ~44px min height keeps tappable cells usable without the old 60px+ rows.
  const shared =
    "flex min-h-11 min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1"
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
  uniqueMissedLeadsReady = false,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
  /** Unique phones among today's misses — when lower than missedCalls, ticker shows LEADS. */
  uniqueMissedLeads?: number
  /** When false, omit “X leads” so refresh does not jump 0→N after /api/calls. */
  uniqueMissedLeadsReady?: boolean
}) {
  const {
    dailyCalls,
    missedCalls,
    holdPathCalls,
    liveLineCount,
    bookingRatePercent,
    bookedJobsCount,
    uniqueCallersCount,
    avgDispatchSpeedMinutes,
    rescueRevenueCents,
    baselineReady,
  } = useRealTimeStatsContext()

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")
  const [rescueOpen, setRescueOpen] = useState(false)

  const bookingEmpty = isBookingRateEmpty(bookingRatePercent)
  const bookingDisplay = baselineReady ? formatBookingRatePercent(bookingRatePercent) : "—"
  // Show booked/callers under the % so Key Squad can see the raw math (e.g. 1/18).
  const bookingFraction =
    baselineReady ? formatBookingJobsFraction(bookedJobsCount, uniqueCallersCount) : null
  const speedDisplay = baselineReady ? formatAvgDispatchSpeedMinutes(avgDispatchSpeedMinutes) : "—"
  // Never flash $0 for Rescue before cache/API settles — show em dash instead.
  const rescueDisplay = formatRescueRevenueDollars(baselineReady ? rescueRevenueCents : null)
  const rescueHot = baselineReady && rescueRevenueCents > 0
  const callsDisplay = baselineReady ? dailyCalls : "—"
  const missedDisplay = baselineReady ? missedCalls : "—"
  const linesDisplay = baselineReady ? liveLineCount : "—"
  const holdPathDisplay = baselineReady ? holdPathCalls : null

  // Raw numbers for the rolling-number animation — null while not ready so the pill just
  // shows "—" with no roll (mirrors the *Display constants above, kept separate since those
  // are pre-formatted strings for the non-animated fallback path).
  const linesAnimated = baselineReady ? liveLineCount : null
  const callsAnimated = baselineReady ? dailyCalls : null
  const missedAnimated = baselineReady ? missedCalls : null
  const bookingAnimated = baselineReady ? bookingRatePercent : null
  const speedAnimated = baselineReady && avgDispatchSpeedMinutes != null ? avgDispatchSpeedMinutes : null
  const rescueAnimated = baselineReady ? rescueRevenueCents : null

  // Prefer seeded/fetched unique-lead count; fall back to missedCalls only while truly unknown.
  // uniqueMissedLeadsReady is true from cookie/session seed — do not wait for /api/calls.
  const hasSeededLeads =
    uniqueMissedLeadsReady && typeof uniqueMissedLeads === "number" && uniqueMissedLeads >= 0
  const uniqueLeads = hasSeededLeads ? uniqueMissedLeads : missedCalls
  const missedLeadCollapse = hasSeededLeads && uniqueLeads > 0 && uniqueLeads < missedCalls
  const missedTickerLabel = formatMissedTickerLabel(missedCalls, uniqueLeads)
  // Hold-path sublabel replaces classic “leads” note when soft-queue handled callers today.
  const missedTickerSublabel =
    baselineReady && holdPathDisplay != null && holdPathDisplay > 0
      ? `${holdPathDisplay} hold path`
      : hasSeededLeads
        ? formatMissedTickerSublabel(missedCalls, uniqueLeads)
        : null
  // Gate on baselineReady like missedDisplay — otherwise this label shows the raw
  // (possibly stale pre-fetch) missedCalls number while the value pill still shows
  // "—", then both rewrite together once the real fetch resolves ("2 unanswered"
  // flips to a different "N unanswered" after settle).
  const missedDesktopLabel = baselineReady && missedLeadCollapse
    ? `${missedCalls} unanswered (${uniqueLeads} leads)`
    : holdPathDisplay && holdPathDisplay > 0
      ? `Unanswered · ${holdPathDisplay} hold path`
      : "Unanswered"

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
        aria-label="Today's dispatch metrics"
      >
        {/* Tighter 3×2 on mobile so Latest / Messages sit higher in the viewport. */}
        <div className={cn(LINES_MOBILE_CARD, "grid grid-cols-3 gap-px p-1")}>
          <TelemetryTickerItem label="Live" value={linesDisplay} animatedValue={linesAnimated} />
          <TelemetryTickerItem
            label="Calls"
            value={callsDisplay}
            animatedValue={callsAnimated}
            onClick={() => openCallHistory("daily")}
          />
          <TelemetryTickerItem
            label={missedTickerLabel}
            value={missedDisplay}
            animatedValue={missedAnimated}
            sublabel={baselineReady ? missedTickerSublabel : null}
            valueClassName={baselineReady && missedCalls > 0 ? "text-amber-300" : undefined}
            labelClassName={missedLeadCollapse ? "text-amber-400/90" : undefined}
            onClick={openMissedRescue}
          />
          <TelemetryTickerItem
            label="Booked jobs"
            value={bookingDisplay}
            animatedValue={bookingAnimated}
            animatedFormatter={formatBookingRatePercent}
            sublabel={bookingFraction}
            sublabelClassName="text-muted-foreground"
            valueClassName={bookingEmpty || !baselineReady ? "font-medium text-muted-foreground" : undefined}
          />
          <TelemetryTickerItem
            label="Dispatch"
            value={speedDisplay}
            animatedValue={speedAnimated}
            animatedFormatter={formatAvgDispatchSpeedMinutes}
          />
          <TelemetryTickerItem
            label="Rescue"
            value={rescueDisplay}
            animatedValue={rescueAnimated}
            animatedFormatter={formatRescueRevenueDollars}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </div>
      </section>
      <section
        className={cn("hidden w-full space-y-2 md:block", className)}
        aria-label="Today's workspace telemetry"
      >
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-4 py-3 backdrop-blur-md">
          <TelemetryPill
            label="Live lines"
            value={linesDisplay}
            animatedValue={linesAnimated}
            icon={Phone}
            tone="teal"
          />
          <TelemetryPill
            label="Calls today"
            value={callsDisplay}
            animatedValue={callsAnimated}
            icon={PhoneIncoming}
            onClick={() => openCallHistory("daily")}
          />
          <TelemetryPill
            label={missedDesktopLabel}
            value={missedDisplay}
            animatedValue={missedAnimated}
            icon={PhoneMissed}
            tone={baselineReady && missedCalls > 0 ? "amber" : "default"}
            valueClassName={baselineReady && missedCalls > 0 ? "text-amber-400" : undefined}
            labelClassName={missedLeadCollapse ? "text-amber-400 font-semibold" : undefined}
            onClick={openMissedRescue}
          />
          <TelemetryPill
            label={
              bookingFraction
                ? `Booked jobs today (${bookingFraction})`
                : "Booked jobs today"
            }
            value={bookingDisplay}
            animatedValue={bookingAnimated}
            animatedFormatter={formatBookingRatePercent}
            icon={Percent}
            tone="teal"
            valueClassName={bookingEmpty || !baselineReady ? "text-sm font-medium text-muted-foreground" : undefined}
          />
          <TelemetryPill
            label="Avg dispatch today"
            value={speedDisplay}
            animatedValue={speedAnimated}
            animatedFormatter={formatAvgDispatchSpeedMinutes}
            icon={Timer}
            tone="teal"
          />
          <TelemetryPill
            label="Rescue today"
            value={rescueDisplay}
            animatedValue={rescueAnimated}
            animatedFormatter={formatRescueRevenueDollars}
            icon={DollarSign}
            tone={rescueHot ? "amber" : "emerald"}
            valueClassName={rescueHot ? "text-amber-300" : "text-emerald-300"}
          />
        </div>
        <p className="px-1 text-micro leading-snug text-muted-foreground">
          <span className="font-medium text-muted-foreground">Missed</span> = true unanswered (hold / press-1
          excluded). <span className="font-medium text-muted-foreground">Booked jobs</span> = real BOOKED jobs
          today ÷ unique callers (not pending time or press-1 alone).{" "}
          <span className="font-medium text-muted-foreground">Rescue $</span> = salvage quotes plus jobs booked
          after hold or press 1.
        </p>
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
